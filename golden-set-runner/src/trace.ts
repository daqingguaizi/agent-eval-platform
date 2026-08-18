// Trace 归一与落盘：把 codex 事件流与客户端执行记录合并成 CaseTrace。
import fs from "node:fs/promises";
import path from "node:path";
import type { CaseTrace, GoldenCase, TraceStep, TraceProvenance, MediaArtifact, TargetProtection } from "./types";
import type { ToolExecutionRecord } from "./headless-canvas";
import type { CanvasAgentSnapshot } from "./target-types";

export type RawAgentEvent = {
    type: string;           // agent_event / agent_log / agent_error
    data: unknown;
    at: number;
    seq?: number;           // Trace v2：run 内单调事件序号，历史 Trace 可缺失
};

export type TurnTraceInput = {
    index: number;
    purpose: "setup" | "target";
    userMessage: string;
    actualPrompt: string;
    rawEvents: RawAgentEvent[];
    clientRecords: ToolExecutionRecord[];
    output: string;
    startedAt: number;
    endedAt: number;
    usage: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
};

// 从原始事件中提炼每个 mcp_tool_call 的事件（含其前后的 agent_message）
type McpToolEvent = {
    itemId: string;
    tool: string;
    arguments: unknown;
    result?: unknown;
    error?: string;
    at: number;
    callId?: string;
};

function extractMcpToolCalls(rawEvents: RawAgentEvent[]): McpToolEvent[] {
    const out: McpToolEvent[] = [];
    for (const ev of rawEvents) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; item?: unknown };
        const item = data?.item as { type?: string; name?: string; tool?: string; arguments?: unknown; result?: unknown; error?: string; id?: string; callId?: string; output?: unknown } | undefined;
        if (!item) continue;
        if (data.type === "item.started" && (item.type === "mcp_tool_call" || (item.type === "mcpToolCall" || item.tool))) {
            // 工具开始
            out.push({ itemId: item.id || `tc-${ev.at}`, tool: String(item.name || item.tool || ""), arguments: item.arguments, at: ev.at, callId: item.callId });
        } else if (data.type === "item.completed" && (item.type === "mcp_tool_call" || item.tool)) {
            // 工具完成，补充 result
            const existing = out.find((t) => t.itemId === item.id);
            if (existing) {
                existing.result = item.result ?? item.output;
                existing.error = item.error;
            } else {
                out.push({ itemId: item.id || `tc-${ev.at}`, tool: String(item.name || item.tool || ""), arguments: item.arguments, result: item.result ?? item.output, error: item.error, at: ev.at, callId: item.callId });
            }
        }
    }
    return out;
}

function extractFinalOutput(rawEvents: RawAgentEvent[]): string {
    // 取最后一个 agent_message 的完整文本（item.completed 或最后一条 item.updated 的 text）
    let last: string | null = null;
    for (const ev of rawEvents) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; item?: { type?: string; text?: string } };
        const item = data?.item;
        if (item && item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) last = item.text;
    }
    return last || "";
}

function extractUsage(rawEvents: RawAgentEvent[]) {
    const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    for (const ev of rawEvents) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; usage?: Record<string, number> };
        if (data.type === "turn.completed" && data.usage) {
            usage.input_tokens = data.usage.input_tokens ?? usage.input_tokens;
            usage.cached_input_tokens = data.usage.cached_input_tokens ?? usage.cached_input_tokens;
            usage.output_tokens = data.usage.output_tokens ?? usage.output_tokens;
            usage.reasoning_output_tokens = data.usage.reasoning_output_tokens ?? usage.reasoning_output_tokens;
        }
    }
    return usage;
}

// 由 canvas-agent 本地答复、不派发到客户端的只读工具
const READ_ONLY_TOOLS = new Set(["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"]);

// 用客户端记录（含 requestId）对齐合并成步骤序列
function buildSteps(rawEvents: RawAgentEvent[], clientRecords: ToolExecutionRecord[]): TraceStep[] {
    const mcpTools = extractMcpToolCalls(rawEvents);
    // 客户端记录按 requestId 建索引
    const clientByRequestId = new Map<string, ToolExecutionRecord>();
    const clientOrder: string[] = [];
    for (const record of clientRecords) {
        clientByRequestId.set(record.requestId, record);
        clientOrder.push(record.requestId);
    }

    // 工具事件与客户端记录按时间对齐。mcp_tool_call 的 callId 与客户端 requestId 可能不同，
    // 因此用「时间 + 工具名」尽力对齐，优先用 requestId 直接匹配（若 event 里带 requestId）。
    const steps: TraceStep[] = [];
    let step = 0;
    const usedClient = new Set<string>();

    const pushTool = (tool: McpToolEvent, record?: ToolExecutionRecord) => {
        step += 1;
        const stepItem: TraceStep = {
            step,
            type: "tool_call",
            tool: tool.tool,
            args: tool.arguments,
            servedBy: record ? "headless-canvas" : "canvas-agent",
            status: tool.error ? "error" : "ok",
            latencyMs: record?.latencyMs,
            result: record?.result ?? tool.result,
            raw: { itemId: tool.itemId, callId: tool.callId },
        };
        if (record) {
            stepItem.ops = record.ops;
            stepItem.rejections = record.rejections;
            stepItem.stateBefore = record.stateBefore;
            stepItem.stateAfter = record.stateAfter;
            stepItem.diff = record.diff;
            stepItem.generations = record.generations;
            if (record.error) {
                stepItem.status = "error";
                stepItem.result = { error: record.error };
            }
        }
        steps.push(stepItem);
    };

    // 对齐规则（依据 canvas-agent canvas-session.callTool）：
    //   canvas_get_state / canvas_get_selection / canvas_export_snapshot 由 canvas-agent 本地答复，
    //   不会派发到浏览器/无头客户端，因此不应匹配任何客户端记录；
    //   其余写工具都会被降解成 canvas_apply_ops 派发给客户端，按时间顺序一一对应。
    for (const tool of mcpTools) {
        let record: ToolExecutionRecord | undefined;
        if (!READ_ONLY_TOOLS.has(tool.tool)) {
            record = clientRecords
                .filter((r) => !usedClient.has(r.requestId) && r.startedAt >= tool.at - 1000)
                .sort((a, b) => a.startedAt - b.startedAt)[0];
            if (record) usedClient.add(record.requestId);
        }
        pushTool(tool, record);
    }

    // 客户端有但 mcp 事件没对齐到的写工具（罕见），补充
    for (const record of clientRecords) {
        if (usedClient.has(record.requestId)) continue;
        if (!record.ops || !record.ops.length) continue;
        step += 1;
        steps.push({
            step,
            type: "tool_call",
            tool: record.name,
            args: record.input,
            ops: record.ops,
            rejections: record.rejections,
            stateBefore: record.stateBefore,
            stateAfter: record.stateAfter,
            diff: record.diff,
            generations: record.generations,
            servedBy: "headless-canvas",
            result: record.result,
            status: record.status,
            latencyMs: record.latencyMs,
        });
    }

    // 模型消息：同一个 item.id 只保留最终文本（item.completed 优先，否则取最后一次 item.updated），
    // 否则流式 delta 会让同一句话重复出现多条。
    const finalTextByItem = new Map<string, { text: string; at: number; completed: boolean }>();
    for (const ev of rawEvents) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; item?: { type?: string; text?: string; id?: string } };
        const item = data?.item;
        if (!item || item.type !== "agent_message" || typeof item.text !== "string" || !item.text.trim()) continue;
        const id = item.id || `msg-${ev.at}`;
        const prev = finalTextByItem.get(id);
        const completed = data.type === "item.completed";
        if (!prev || completed || (!prev.completed && ev.at >= prev.at)) {
            finalTextByItem.set(id, { text: item.text, at: prev?.at ?? ev.at, completed: completed || Boolean(prev?.completed) });
        }
    }
    const modelSteps: TraceStep[] = [];
    for (const { text } of [...finalTextByItem.values()].sort((a, b) => a.at - b.at)) {
        step += 1;
        modelSteps.push({ step, type: "model_message", status: "ok", result: { text } });
    }
    // 合并：把 model_message 按 step 顺序插入到 steps 里（重新排序）
    const all = [...modelSteps, ...steps].sort((a, b) => a.step - b.step);
    // 重新编号
    all.forEach((s, i) => (s.step = i + 1));
    return all;
}

export type BuildTraceParams = {
    runId: string;
    caseId: string;
    sessionId: string;
    attempt: number;
    golden: GoldenCase;
    turns: TurnTraceInput[];
    finalState: CanvasAgentSnapshot;
    versions: { canvasAgent: string; codex: string; model: string; provider: string; agentPromptSha: string };
    config: { canvasType: "content" | "story"; codexHome: string; repeat: number };
    rawEventsFile: string;
    inputMedia?: MediaArtifact[];
    artifacts?: MediaArtifact[];
    targetProtection?: TargetProtection;
    executionStatus?: "complete" | "failed" | "timeout" | "blocked";
    additionalErrors?: Array<{ scope: string; message: string }>;
    provenance?: TraceProvenance;
};

export function buildTrace(params: BuildTraceParams): CaseTrace {
    const { turns } = params;
    const totalMs = turns.length ? turns[turns.length - 1].endedAt - turns[0].startedAt : 0;
    const builtTurns = turns.map((turn) => {
        const steps = buildSteps(turn.rawEvents, turn.clientRecords);
        const usage = extractUsage(turn.rawEvents);
        const toolCalls = steps.filter((s) => s.type === "tool_call").length;
        return {
            index: turn.index,
            purpose: turn.purpose,
            userMessage: turn.userMessage,
            actualPrompt: turn.actualPrompt,
            steps,
            output: turn.output || extractFinalOutput(turn.rawEvents),
            startedAt: turn.startedAt,
            endedAt: turn.endedAt,
            durationMs: turn.endedAt - turn.startedAt,
            usage: { ...usage, tool_calls: toolCalls },
        };
    });

    const totalToolCalls = builtTurns.reduce((sum, t) => sum + t.usage.tool_calls, 0);
    const declared = params.golden.budgets;
    const observed = {
        toolCalls: totalToolCalls,
        latencyMs: totalMs,
        tokens: builtTurns.reduce((sum, t) => sum + (t.usage.input_tokens || 0) + (t.usage.output_tokens || 0), 0),
    };
    const exceeded: string[] = [];
    if (declared.maxToolCalls && observed.toolCalls > declared.maxToolCalls) exceeded.push("maxToolCalls");
    if (declared.maxLatencyMs && observed.latencyMs > declared.maxLatencyMs) exceeded.push("maxLatencyMs");
    if (declared.maxTokens && observed.tokens > declared.maxTokens) exceeded.push("maxTokens");

    const costCny = estimateCost(observed.tokens);

    return {
        run_id: params.runId,
        case_id: params.caseId,
        session_id: params.sessionId,
        trace_id: `${params.runId}-${params.caseId}-${params.attempt}`,
        attempt: params.attempt,
        versions: { agent: "codex", ...params.versions, caseVersion: params.golden.version },
        config: params.config,
        turns: builtTurns,
        finalState: params.finalState,
        usage: {
            input_tokens: builtTurns.reduce((s, t) => s + (t.usage.input_tokens || 0), 0),
            output_tokens: builtTurns.reduce((s, t) => s + (t.usage.output_tokens || 0), 0),
            tool_calls: totalToolCalls,
            latency_ms: totalMs,
            cost_cny: costCny,
        },
        budget: { declared, observed, exceeded },
        errors: [...collectErrors(turns), ...(params.additionalErrors || [])],
        inputMedia: params.inputMedia,
        artifacts: params.artifacts,
        targetProtection: params.targetProtection,
        executionStatus: params.executionStatus || "complete",
        rawEventsFile: params.rawEventsFile,
        provenance: params.provenance,
    };
}

function estimateCost(totalTokens: number): number {
    // DeepSeek 近似定价：deepseek-chat 输入 ~0.27 元/百万 tokens、输出 ~1.1 元/百万 tokens
    // 这里用总 token 数粗估，仅作展示参考，不判罚。
    return Math.round((totalTokens / 1_000_000) * 0.6 * 100) / 100;
}

function collectErrors(turns: TurnTraceInput[]) {
    const errors: Array<{ scope: string; message: string }> = [];
    for (const turn of turns) {
        for (const ev of turn.rawEvents) {
            if (ev.type === "agent_error") {
                errors.push({ scope: `turn-${turn.index}`, message: String((ev.data as { message?: unknown })?.message ?? ev.data) });
            }
        }
        for (const record of turn.clientRecords) {
            if (record.status === "error" && record.error) {
                errors.push({ scope: `turn-${turn.index}-tool-${record.name}`, message: record.error });
            }
        }
    }
    return errors;
}

// ---- 落盘 ----

export async function writeTrace(runDir: string, trace: CaseTrace, rawEvents: RawAgentEvent[]) {
    const tracesDir = path.join(runDir, "traces");
    const rawDir = path.join(runDir, "raw");
    const artifactsDir = path.join(runDir, "artifacts");
    await fs.mkdir(tracesDir, { recursive: true });
    await fs.mkdir(rawDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });

    const base = `${trace.case_id}-${trace.attempt}`;
    const traceFile = path.join(tracesDir, `${base}.json`);
    const rawFile = path.join(rawDir, `${base}.jsonl`);
    await fs.writeFile(traceFile, JSON.stringify(trace, null, 2), "utf8");
    const lines = rawEvents.map((ev) => JSON.stringify({ ...ev, data: serializeSafe(ev.data) })).join("\n");
    await fs.writeFile(rawFile, lines + "\n", "utf8");
    return { traceFile, rawFile };
}

function serializeSafe(value: unknown): unknown {
    try {
        JSON.stringify(value);
        return value;
    } catch {
        return String(value);
    }
}

// 汇总 index.json：每个用例一条，含状态与耗时，供 viewer 列表用。
export type CaseIndexEntry = {
    case_id: string;
    title: string;
    scenario: string;
    risk: string;
    sampleType: string;
    canvasType: string;
    attempt: number;
    turns: number;
    toolCalls: number;
    hasRejections: boolean;
    hasErrors: boolean;
    exceededBudget: string[];
    latencyMs: number;
    status?: "complete" | "failed" | "timeout" | "blocked";
    modality?: string;
    inputMedia?: MediaArtifact[];
    artifacts?: MediaArtifact[];
    traceFile: string;
};

export async function writeIndex(runDir: string, entries: CaseIndexEntry[], meta: Record<string, unknown>) {
    const index = { meta, cases: entries };
    await fs.writeFile(path.join(runDir, "index.json"), JSON.stringify(index, null, 2), "utf8");
    return path.join(runDir, "index.json");
}

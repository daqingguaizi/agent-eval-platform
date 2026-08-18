// 无头画布客户端：复刻浏览器 canvas-local-agent-panel.tsx 的 SSE 生命周期与
// canvas-client-page.tsx 的 applyAgentOps 行为，但纯 Node 实现。
import { applyCanvasAgentOps } from "./target-adapter";
import type { CanvasAgentOp, CanvasAgentSnapshot, CanvasAgentOpRejection } from "./target-types";
import { blankSnapshot, deepClone, diffSnapshots, type CanvasDiff } from "./canvas-snapshot";
import type { CanvasType } from "./types";

export type PendingToolCall = { requestId: string; name: string; input: { ops?: CanvasAgentOp[] } };
export type AgentTurnResult = { status: "done" | "agent_error" | "timeout"; error?: string };

export type ToolExecutionRecord = {
    requestId: string;
    name: string;
    input: unknown;
    servedBy: "canvas-agent" | "headless-canvas";
    startedAt: number;
    endedAt?: number;// finally 中回填
    latencyMs: number;
    result?: unknown;                      // 实际返回给模型的（内容可能被 compactNode 截断）
    ops?: CanvasAgentOp[];                 // 降解后的 ops（仅写工具）
    rejections?: CanvasAgentOpRejection[];
    stateBefore?: CanvasAgentSnapshot;     // 完整快照（未截断）
    stateAfter?: CanvasAgentSnapshot;
    diff?: CanvasDiff;
    generations?: GenerationRecord[];      // 该工具触发的生成任务
    status: "ok" | "error";
    error?: string;
};

export type GenerationRecord = {
    nodeId: string;
    mode: string;
    prompt: string;
    startedAt: number;
    endedAt?: number;
    durationMs?: number;
    artifact?: string;                     // runs/<runId>/artifacts 下的相对路径
    error?: string;
};

// 用户可注入的生成执行器：返回产物相对路径（如 artifacts/xxx.png），失败抛错。
export type GenerationExecutor = (op: Extract<CanvasAgentOp, { type: "run_generation" }>, snapshot: CanvasAgentSnapshot) => Promise<{ artifact?: string }>;

// SSE 事件回调
export type HeadlessEvents = {
    onHello: () => void;
    onToolCall: (payload: PendingToolCall) => void;
    onAgentEvent: (type: string, data: unknown) => void;
    onToolExecuted: (record: ToolExecutionRecord) => void;
    onStateChanged: (snapshot: CanvasAgentSnapshot) => void;
};

type SseEvent = { event: string; data: string };

// 解析 SSE 帧：event: <type>\ndata: <json>\n\n
function parseSseFrame(buffer: string): { frames: SseEvent[]; rest: string } {
    const frames: SseEvent[] = [];
    let rest = buffer;
    while (true) {
        const idx = rest.indexOf("\n\n");
        if (idx < 0) break;
        const raw = rest.slice(0, idx);
        rest = rest.slice(idx + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        frames.push({ event, data: dataLines.join("\n") });
    }
    return { frames, rest };
}

export class HeadlessCanvasClient {
    private snapshot: CanvasAgentSnapshot;
    private clientId: string;
    private events: HeadlessEvents;
    private generationExecutor?: GenerationExecutor;
    private endpoint: string;
    private token: string;
    private abort?: AbortController;
    private records: ToolExecutionRecord[] = [];
    private pendingGenerations: Promise<void>[] = [];
    private generationCount = 0;
    private connected = false;
    private doneResolvers: Array<(result: AgentTurnResult) => void> = [];
    onAgentEvent: (type: string, data: unknown) => void = () => {};

    constructor(canvasType: CanvasType, clientId: string, endpoint: string, token: string, events: HeadlessEvents, generationExecutor?: GenerationExecutor) {
        this.snapshot = blankSnapshot(canvasType);
        this.clientId = clientId;
        this.endpoint = endpoint;
        this.token = token;
        this.events = events;
        this.generationExecutor = generationExecutor;
    }

    getSnapshot() {
        return this.snapshot;
    }
    getRecords() {
        return this.records;
    }
    getClientId() {
        return this.clientId;
    }
    getGenerationCount() {
        return this.generationCount;
    }
    isConnected() {
        return this.connected;
    }

    reset(canvasType: CanvasType) {
        this.snapshot = blankSnapshot(canvasType);
        this.records = [];
        this.pendingGenerations = [];
        this.generationCount = 0;
    }

    // 复刻 canvas-client-page.tsx applyAgentOps：过滤 run_generation，其余交 applyCanvasAgentOps，
    // run_generation 在 microtask 里异步分流。
    private applyOps(ops: CanvasAgentOp[]) {
        const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
        const before = deepClone(this.snapshot);
        const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
        const next = applyCanvasAgentOps(before, safeOps.filter((op) => op.type !== "run_generation"));
        // rejections 是执行层返回的元信息，不应作为快照状态持久化
        const { rejections, ...clean } = next as CanvasAgentSnapshot & { rejections?: CanvasAgentOpRejection[] };
        this.snapshot = { ...clean, projectId: before.projectId, title: before.title };
        const generations: GenerationRecord[] = [];
        if (generationOps.length) {
            // fire-and-forget：立即返回工具结果，后台跑生成（浏览器用 queueMicrotask）
            for (const op of generationOps) {
                const target = this.snapshot.nodes.find((node) => node.id === op.nodeId);
                const modeValue = op.mode || target?.metadata?.generationMode || "image";
                const mode = typeof modeValue === "string" ? modeValue : "image";
                const promptValue = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                const prompt = typeof promptValue === "string" ? promptValue : "";
                generations.push(this.runGeneration(op, mode, prompt));
            }
        }
        return { snapshot: this.snapshot, rejections, generations };
    }

    private runGeneration(op: Extract<CanvasAgentOp, { type: "run_generation" }>, mode: string, prompt: string): GenerationRecord {
        const record: GenerationRecord = { nodeId: op.nodeId, mode, prompt, startedAt: Date.now() };
        this.generationCount += 1;
        const p = (async () => {
            try {
                if (!this.generationExecutor) throw new Error("未配置生成执行器（WorkRally）");
                const result = await this.generationExecutor(op, this.snapshot);
                record.artifact = result.artifact;
                const target = this.snapshot.nodes.find((node) => node.id === op.nodeId);
                if (target) {
                    target.metadata = { ...target.metadata, status: "success", content: result.artifact || target.metadata?.content, prompt };
                }
                this.events.onStateChanged(this.snapshot);
                await this.postState();
            } catch (error) {
                record.error = error instanceof Error ? error.message : String(error);
                const target = this.snapshot.nodes.find((node) => node.id === op.nodeId);
                if (target) target.metadata = { ...target.metadata, status: "error" };
                this.events.onStateChanged(this.snapshot);
                await this.postState();
            } finally {
                record.endedAt = Date.now();
                record.durationMs = record.endedAt - record.startedAt;
            }
        })();
        this.pendingGenerations.push(p);
        return record;
    }

    // 等待所有挂起的生成任务结束（用例收尾前调用）
    async waitForPendingGenerations(timeoutMs = 10 * 60 * 1000) {
        const start = Date.now();
        while (this.pendingGenerations.length) {
            const tasks = this.pendingGenerations.splice(0);
            await Promise.race([Promise.allSettled(tasks), delay(Math.max(1, timeoutMs - (Date.now() - start)))]);
            if (Date.now() - start > timeoutMs) throw new Error("等待生成任务超时");
        }
    }

    // 建立 SSE 连接，返回连接 URL。读循环在后台异步跑。
    connect() {
        const url = `${this.endpoint}/events?token=${encodeURIComponent(this.token)}&clientId=${encodeURIComponent(this.clientId)}`;
        this.abort = new AbortController();
        void this.readLoop(url);
        return url;
    }

    private async readLoop(url: string) {
        let attempt = 0;
        while (!this.abort?.signal.aborted) {
            try {
                const res = await fetch(url, { headers: { "x-canvas-agent-token": this.token }, signal: this.abort?.signal });
                if (!res.ok || !res.body) throw new Error(`SSE 连接失败：HTTP ${res.status}`);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (!this.abort?.signal.aborted) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const { frames, rest } = parseSseFrame(buffer);
                    buffer = rest;
                    for (const frame of frames) this.handleFrame(frame);
                }
                // 正常读到流结束（未 abort），等待短暂后重连
                if (!this.abort?.signal.aborted) await delay(500);
            } catch (error) {
                if (this.abort?.signal.aborted) return;
                this.events.onAgentEvent("sse_error", { message: error instanceof Error ? error.message : String(error) });
                attempt += 1;
                if (attempt > 30) {
                    this.events.onAgentEvent("sse_fatal", { message: "SSE 重连次数超限" });
                    return;
                }
                await delay(Math.min(1000 * attempt, 5000));
            }
        }
    }

    private handleFrame(frame: SseEvent) {
        if (frame.event === "hello") {
            this.connected = true;
            this.events.onHello();
            void this.postState();
            return;
        }
        if (!frame.data) return;
        let data: unknown;
        try {
            data = JSON.parse(frame.data);
        } catch {
            data = frame.data;
        }
        if (frame.event === "tool_call") {
            const payload = data as PendingToolCall;
            this.events.onToolCall(payload);
            void this.runToolCall(payload);
            return;
        }
        this.onAgentEvent(frame.event, data);
        this.events.onAgentEvent(frame.event, data);
        // canvas-agent 用独立 SSE 事件名标记本轮生命周期。
        // agent_done 后短暂延迟解析，避免同一事件批次随后出现 agent_error 时被误判为成功。
        if (frame.event === "agent_error") {
            this.resolveAgentError(data);
        } else if (frame.event === "agent_done") {
            setTimeout(() => this.resolveDone(), 20);
        }
    }

    // 通过目标产品相同的 applyCanvasAgentOps 执行 Runner 前置媒体接入，随后同步给真实 Agent。
    async applyFixtureOps(ops: CanvasAgentOp[]) {
        const before = deepClone(this.snapshot);
        const { snapshot, rejections } = this.applyOps(ops);
        await this.postState();
        return { stateBefore: before, stateAfter: deepClone(snapshot), rejections };
    }

    // 上报当前快照（供编排器在 reset 后立即同步画布状态）
    async postStatePublic() {
        await this.postState();
    }

    private resolveDone() {
        const resolvers = this.doneResolvers.splice(0);
        resolvers.forEach((resolve) => resolve({ status: "done" }));
    }

    private resolveAgentError(data: unknown) {
        const message = typeof data === "object" && data && "message" in data
            ? String((data as { message?: unknown }).message ?? "Agent lifecycle error")
            : String(data || "Agent lifecycle error");
        const resolvers = this.doneResolvers.splice(0);
        resolvers.forEach((resolve) => resolve({ status: "agent_error", error: message }));
    }

    // 等待本轮 agent_done 或 agent_error；超时也以结构化状态返回。发送 turn 后调用。
    async waitForAgentDone(timeoutMs: number): Promise<AgentTurnResult> {
        return new Promise((resolve) => {
            let settled = false;
            const doneResolver = (result: AgentTurnResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => {
                if (settled) return;
                const idx = this.doneResolvers.indexOf(doneResolver);
                if (idx >= 0) this.doneResolvers.splice(idx, 1);
                doneResolver({ status: "timeout" });
            }, timeoutMs);
            this.doneResolvers.push(doneResolver);
        });
    }

    // 复刻 canvas-local-agent-panel.tsx runToolCall：
    // canvas_apply_ops -> applyOps；其余读工具 -> 返回当前快照。先 postState 再 postToolResult。
    private async runToolCall(payload: PendingToolCall) {
        const record: ToolExecutionRecord = {
            requestId: payload.requestId,
            name: payload.name,
            input: payload.input,
            servedBy: "headless-canvas",
            startedAt: Date.now(),
            latencyMs: 0,
            status: "ok",
        };
        try {
            let result: unknown;
            if (payload.name === "canvas_apply_ops") {
                const ops = payload.input?.ops || [];
                record.ops = ops;
                const stateBefore = deepClone(this.snapshot);
                record.stateBefore = stateBefore;
                const { snapshot, rejections, generations } = this.applyOps(ops);
                record.stateAfter = deepClone(snapshot);
                record.diff = diffSnapshots(stateBefore, snapshot);
                if (rejections?.length) record.rejections = rejections;
                if (generations.length) record.generations = generations;
                result = snapshot;
            } else {
                // 读工具（canvas_get_state 等）由 canvas-agent 本地答复，不会派发到客户端；
                // 这里兜底：若被派发，返回当前快照。
                record.servedBy = "canvas-agent";
                result = this.snapshot;
            }
            record.result = result;
            await this.postState();
            await this.postResult(payload.requestId, { requestId: payload.requestId, result });
            this.events.onToolExecuted(record);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            record.status = "error";
            record.error = message;
            try {
                await this.postResult(payload.requestId, { requestId: payload.requestId, error: message });
            } catch {
                // 回传失败不阻塞
            }
            this.events.onToolExecuted(record);
        } finally {
            record.endedAt = Date.now();
            record.latencyMs = record.endedAt - record.startedAt;
            // 存档供 trace 合并使用（ops / diff / stateBefore / stateAfter 都在这里）
            this.records.push(record);
        }
    }

    private async postState() {
        try {
            await fetch(`${this.endpoint}/canvas/state?token=${encodeURIComponent(this.token)}&clientId=${encodeURIComponent(this.clientId)}`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-canvas-agent-token": this.token },
                body: JSON.stringify(this.snapshot),
            });
        } catch {
            // 上报失败不阻塞（后续会重试）
        }
        this.events.onStateChanged(this.snapshot);
    }

    private async postResult(requestId: string, body: unknown) {
        await fetch(`${this.endpoint}/canvas/result?token=${encodeURIComponent(this.token)}&clientId=${encodeURIComponent(this.clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-canvas-agent-token": this.token },
            body: JSON.stringify(body),
        });
    }

    async close() {
        this.abort?.abort();
        this.connected = false;
    }
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

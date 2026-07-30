/**
 * Echo 模拟执行器
 * 根据评测用例的 expected 结构合成一条合理的归一化 Trace，
 * 用于演示跑分（离线，不连 canvas-agent）。
 *
 * 合成逻辑：
 * 1. 从 evalCase.expected.toolCalls 生成 tool spans（参数从 params.$eq 或原值提取）
 * 2. 从 evalCase.expected.stateAfter 生成 stateAfter
 * 3. 若 expected.safety 中有约束，guardrail span 标记 ok
 * 4. 补充 LLM 决策 span
 */
import type { NormalizedTrace, Span } from "@/types/normalized-trace";

let _counter = 0;
function simId(prefix: string) {
  return `${prefix}-sim-${Date.now()}-${++_counter}`;
}

export interface SimEvalCase {
  id: string;
  title?: string;
  category?: string;
  priority?: string;
  precondition?: {
    canvasType?: string;
    initialState?: Record<string, unknown>;
  };
  input?: { type?: string; message?: string };
  expected?: {
    toolCalls?: Array<{ tool: string; params?: Record<string, unknown> }>;
    stateAfter?: Record<string, unknown>;
    safety?: Record<string, unknown>;
    outcome?: Record<string, unknown>;
  };
  judge?: {
    strategy?: string;
    rules?: Array<{ type: string; [k: string]: unknown }>;
    llmJudge?: { enabled?: boolean; criteria?: unknown[] };
  };
}

/**
 * 合成一条归一化 Trace（模拟 Echo 成功执行的轨迹）
 */
export function simulateTrace(evalCase: SimEvalCase): NormalizedTrace {
  const now = Date.now();
  const spans: Span[] = [];
  let spanTime = now;

  const toolCalls = evalCase.expected?.toolCalls ?? [];

  // LLM 决策 span
  spans.push({
    spanId: simId("sp"),
    kind: "llm",
    name: "simulated-model",
    input: { message: evalCase.input?.message ?? "" },
    output: { toolCalls: toolCalls.map((tc) => tc.tool), text: "模拟执行" },
    startTime: spanTime,
    durationMs: 120,
    status: "ok",
  });
  spanTime += 150;

  // Tool spans
  for (const tc of toolCalls) {
    const params = extractSimParams(tc.params);
    spans.push({
      spanId: simId("sp"),
      kind: "tool",
      name: tc.tool,
      input: params,
      output: { success: true, simulated: true },
      startTime: spanTime,
      durationMs: 50,
      status: "ok",
    });
    spanTime += 80;
  }

  // Guardrail span（如果有 safety 约束）
  if (evalCase.expected?.safety) {
    spans.push({
      spanId: simId("sp"),
      kind: "guardrail",
      name: "canvas-safety-constraint",
      input: evalCase.expected.safety,
      output: { passed: true, violations: [] },
      startTime: spanTime,
      durationMs: 10,
      status: "ok",
    });
  }

  // 构建 stateAfter
  const stateAfter = buildSimulatedState(evalCase);

  return {
    traceId: simId("tr"),
    sessionId: simId("sess"),
    turnId: simId("turn"),
    agentType: "task-execution+creative",
    agentId: "echo",
    source: "pre-release",
    input: {
      type: "text",
      message: evalCase.input?.message ?? "",
    },
    spans,
    outcome: {
      finalText: evalCase.expected?.outcome?.successCriteria
        ? String(evalCase.expected.outcome.successCriteria)
        : "模拟执行完成",
    },
    stateBefore: evalCase.precondition?.initialState
      ? { canvasType: evalCase.precondition.canvasType, ...evalCase.precondition.initialState }
      : undefined,
    stateAfter,
    usage: {
      toolCalls: toolCalls.length,
      latencyMs: spanTime - now + 50,
    },
    versions: { agent: "simulated-echo" },
    startTime: now,
    durationMs: spanTime - now + 50,
    meta: {
      caseId: evalCase.id,
      simulated: true,
      canvasType: evalCase.precondition?.canvasType,
    },
  };
}

/** 从 match rule 提取最终参数值（$eq → 原值，$contains → 构造含关键词的值） */
function extractSimParams(
  params?: Record<string, unknown>
): Record<string, unknown> {
  if (!params) return {};
  const result: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(params)) {
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      const r = rule as Record<string, unknown>;
      if ("$eq" in r) result[key] = r.$eq;
      else if ("$contains" in r) result[key] = `内容包含${r.$contains}的文本`;
      else if ("$regex" in r) result[key] = `匹配正则${r.$regex}的值`;
      else if ("$gte" in r) result[key] = r.$gte;
      else if ("$lte" in r) result[key] = r.$lte;
      else result[key] = extractSimParams(r as Record<string, unknown>);
    } else {
      result[key] = rule;
    }
  }
  return result;
}

/** 从 expected.stateAfter 构建满足断言的模拟状态 */
function buildSimulatedState(evalCase: SimEvalCase): Record<string, unknown> | undefined {
  const stateExp = evalCase.expected?.stateAfter;
  if (!stateExp) return undefined;

  const state: Record<string, unknown> = {
    canvasType: evalCase.precondition?.canvasType ?? "content",
  };

  // nodeCount
  const nodeCount = extractValue(stateExp.nodeCount) ?? 0;
  const nodes: Array<Record<string, unknown>> = [];

  // 从 nodes 定义或 toolCalls 推导
  if (stateExp.nodes && Array.isArray(stateExp.nodes)) {
    for (const expNode of stateExp.nodes) {
      const node: Record<string, unknown> = { id: simId("node") };
      for (const [k, v] of Object.entries(expNode)) {
        node[k] = extractValue(v) ?? v;
      }
      nodes.push(node);
    }
  }

  // 补齐到 nodeCount
  while (nodes.length < (typeof nodeCount === "number" ? nodeCount : 0)) {
    nodes.push({ id: simId("node"), type: "text", title: "模拟节点" });
  }

  state.nodes = nodes;
  state.connections = [];
  return state;
}

function extractValue(rule: unknown): unknown {
  if (rule === null || rule === undefined) return undefined;
  if (typeof rule !== "object") return rule;
  const r = rule as Record<string, unknown>;
  if ("$eq" in r) return r.$eq;
  if ("$gte" in r) return r.$gte;
  return undefined;
}

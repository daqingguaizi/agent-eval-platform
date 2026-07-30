import type { NormalizedTrace } from "@/types";
import { matchObject, matchValue } from "./param-matcher";

export interface ScorerResult {
  verdict: "pass" | "soft_pass" | "fail";
  ruleType: string;
  reason: string;
  details?: unknown;
}

type Expected = Record<string, unknown>;
type RuleConfig = { type: string; [key: string]: unknown };

function toolSpans(trace: NormalizedTrace) {
  return trace.spans.filter((span) => span.kind === "tool");
}

function toolCallMatch(trace: NormalizedTrace, expected: Expected): ScorerResult {
  const calls = Array.isArray(expected.toolCalls) ? expected.toolCalls as Array<{ tool?: string; params?: Record<string, unknown> }> : [];
  const actual = toolSpans(trace);
  if (!calls.length) return actual.length ? { verdict: "fail", ruleType: "tool_call_match", reason: `期望无工具调用，实际调用 ${actual.map((item) => item.name).join(", ")}` } : { verdict: "pass", ruleType: "tool_call_match", reason: "无工具调用，符合预期" };
  const failures = calls.flatMap((call) => {
    const span = actual.find((item) => item.name === call.tool);
    if (!span) return [`未调用必要工具 ${call.tool}`];
    if (!call.params) return [];
    const result = matchObject(typeof span.input === "object" && span.input !== null ? span.input as Record<string, unknown> : {}, call.params);
    return result.pass ? [] : [`${call.tool} 参数不匹配：${result.failures.join("；")}`];
  });
  return failures.length ? { verdict: "fail", ruleType: "tool_call_match", reason: failures.join("；"), details: { failures } } : { verdict: "pass", ruleType: "tool_call_match", reason: "必要工具和参数均符合预期" };
}

function toolCallOrder(trace: NormalizedTrace, expected: Expected, rule: RuleConfig): ScorerResult {
  const sequence = (rule.steps ?? expected.required_steps ?? []) as string[];
  const names = toolSpans(trace).map((item) => item.name);
  let index = -1;
  for (const name of sequence) {
    index = names.indexOf(name, index + 1);
    if (index < 0) return { verdict: "fail", ruleType: "tool_call_order", reason: `关键步骤顺序不满足：缺少或乱序 ${name}` };
  }
  return { verdict: "pass", ruleType: "tool_call_order", reason: "关键工具顺序符合预期" };
}

function stateDiff(trace: NormalizedTrace, expected: Expected): ScorerResult {
  const stateExpected = expected.stateAfter as Record<string, unknown> | undefined;
  if (!stateExpected) return { verdict: "pass", ruleType: "state_diff_check", reason: "无状态断言" };
  const actual = trace.stateAfter;
  if (!actual) return { verdict: "fail", ruleType: "state_diff_check", reason: "缺少 stateAfter" };
  const failures: string[] = [];
  if (stateExpected.nodeCount !== undefined && !matchValue(Array.isArray(actual.nodes) ? actual.nodes.length : 0, stateExpected.nodeCount)) failures.push("节点数量不符合预期");
  if (stateExpected.connectionCount !== undefined && !matchValue(Array.isArray(actual.connections) ? actual.connections.length : 0, stateExpected.connectionCount)) failures.push("连线数量不符合预期");
  if (Array.isArray(stateExpected.nodes)) for (const expectedNode of stateExpected.nodes) if (!Array.isArray(actual.nodes) || !actual.nodes.some((node) => typeof node === "object" && node !== null && matchObject(node as Record<string, unknown>, expectedNode as Record<string, unknown>).pass)) failures.push(`未找到期望节点 ${JSON.stringify(expectedNode)}`);
  return failures.length ? { verdict: "fail", ruleType: "state_diff_check", reason: failures.join("；") } : { verdict: "pass", ruleType: "state_diff_check", reason: "状态断言通过" };
}

function safety(trace: NormalizedTrace, expected: Expected): ScorerResult {
  const rules = expected.safety as Record<string, unknown> | undefined;
  if (!rules) return { verdict: "pass", ruleType: "safety_check", reason: "无安全约束断言" };
  const state = trace.stateAfter ?? {};
  const canvasType = trace.meta?.canvasType;
  const nodes = Array.isArray(state.nodes) ? state.nodes as Array<Record<string, unknown>> : [];
  const connections = Array.isArray(state.connections) ? state.connections as Array<Record<string, unknown>> : [];
  const failures: string[] = [];
  if (rules.noStoryNodesInContent && canvasType === "content" && nodes.some((node) => ["story-choice", "game-outcome", "story-start", "story-end"].includes(String(node.type)))) failures.push("Content 画布出现编排节点");
  if (rules.noRuntimeConnectionsInContent && canvasType === "content" && connections.some((item) => ["story-choice", "game-outcome"].includes(String(item.kind)))) failures.push("Content 画布出现运行态连线");
  if (trace.spans.some((span) => span.kind === "guardrail" && span.status === "error")) failures.push("安全护栏执行失败");
  return failures.length ? { verdict: "fail", ruleType: "safety_check", reason: failures.join("；") } : { verdict: "pass", ruleType: "safety_check", reason: "安全约束通过" };
}

function forbiddenTool(trace: NormalizedTrace, expected: Expected, rule: RuleConfig): ScorerResult {
  const forbidden = (rule.tools ?? expected.forbidden_actions ?? []) as string[];
  const violations = toolSpans(trace).filter((span) => forbidden.includes(span.name));
  return violations.length ? { verdict: "fail", ruleType: "forbidden_tool", reason: `调用禁止工具：${violations.map((item) => item.name).join(", ")}` } : { verdict: "pass", ruleType: "forbidden_tool", reason: "未调用禁止工具" };
}

function formatCheck(trace: NormalizedTrace, expected: Expected): ScorerResult {
  const format = (expected.outcome as Record<string, unknown> | undefined)?.format;
  if (!format) return { verdict: "pass", ruleType: "format_check", reason: "无输出格式断言" };
  return typeof trace.outcome.finalText === "string" && trace.outcome.finalText.trim() ? { verdict: "pass", ruleType: "format_check", reason: "输出格式基础校验通过" } : { verdict: "fail", ruleType: "format_check", reason: "最终输出为空" };
}

function efficiency(trace: NormalizedTrace, expected: Expected): ScorerResult {
  const failures: string[] = [];
  if (typeof expected.max_tool_calls === "number" && toolSpans(trace).length > expected.max_tool_calls) failures.push(`工具调用 ${toolSpans(trace).length} 超出上限 ${expected.max_tool_calls}`);
  if (typeof expected.max_latency_ms === "number" && (trace.usage.latencyMs ?? trace.durationMs ?? 0) > expected.max_latency_ms) failures.push("时延超出上限");
  if (typeof expected.max_tokens === "number" && (trace.usage.totalTokens ?? 0) > expected.max_tokens) failures.push("Token 超出上限");
  return failures.length ? { verdict: "fail", ruleType: "efficiency_check", reason: failures.join("；") } : { verdict: "pass", ruleType: "efficiency_check", reason: "资源约束通过" };
}

const handlers: Record<string, (trace: NormalizedTrace, expected: Expected, rule: RuleConfig) => ScorerResult> = {
  tool_call_match: (trace, expected) => toolCallMatch(trace, expected),
  param_check: (trace, expected) => toolCallMatch(trace, expected),
  tool_call_order: toolCallOrder,
  state_diff_check: (trace, expected) => stateDiff(trace, expected),
  safety_check: (trace, expected) => safety(trace, expected),
  forbidden_tool: forbiddenTool,
  format_check: (trace, expected) => formatCheck(trace, expected),
  efficiency_check: (trace, expected) => efficiency(trace, expected),
  consistency_check: () => ({ verdict: "pass", ruleType: "consistency_check", reason: "由 Trial 聚合阶段判定" }),
};

export function runRuleScorer(trace: NormalizedTrace, expected: Expected, rules: RuleConfig[]): ScorerResult[] {
  return rules.map((rule) => (handlers[rule.type] ?? (() => ({ verdict: "fail" as const, ruleType: rule.type, reason: `未知规则类型：${rule.type}` })))(trace, expected, rule));
}

export function aggregateResults(results: ScorerResult[]) {
  const failures = results.filter((result) => result.verdict === "fail");
  if (failures.length) return { verdict: "fail" as const, reason: failures.map((result) => `[${result.ruleType}] ${result.reason}`).join("；") };
  return results.some((result) => result.verdict === "soft_pass") ? { verdict: "soft_pass" as const, reason: "部分规则软通过" } : { verdict: "pass" as const, reason: "全部规则通过" };
}

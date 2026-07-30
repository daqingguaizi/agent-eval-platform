import { evaluateGate } from "@/lib/scoring-gate";
import { identifyBadcases } from "@/rca";
import { prisma } from "@/lib/prisma";
import type { CaseResult, EvalCase, NormalizedTrace, ScorerVerdict } from "@/types";
import { aggregateLlmResults, runLlmJudge } from "./llm";
import { aggregateResults, runRuleScorer } from "./rule";

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function fromRecord(record: { traceId: string; eventKey: string | null; sessionId: string; turnId: string; agentType: string; agentId: string; skillId: string | null; caseId: string | null; source: string; runId: string | null; trialId: string | null; input: string; spans: string; outcome: string; stateBefore: string | null; stateAfter: string | null; usage: string; versions: string; meta: string | null; startTime: Date; durationMs: number | null }): NormalizedTrace {
  return {
    traceId: record.traceId, eventKey: record.eventKey ?? undefined, sessionId: record.sessionId, turnId: record.turnId,
    agentType: record.agentType, agentId: record.agentId, skillId: record.skillId ?? undefined, caseId: record.caseId ?? undefined,
    source: record.source as NormalizedTrace["source"], runId: record.runId ?? undefined, trialId: record.trialId ?? undefined,
    input: parse(record.input, { type: "text", message: "" }), spans: parse(record.spans, []), outcome: parse(record.outcome, { finalText: "" }),
    stateBefore: record.stateBefore ? parse(record.stateBefore, {}) : undefined, stateAfter: record.stateAfter ? parse(record.stateAfter, {}) : undefined,
    usage: parse(record.usage, {}), versions: parse(record.versions, {}), meta: record.meta ? parse(record.meta, {}) : undefined,
    startTime: record.startTime.getTime(), durationMs: record.durationMs ?? undefined,
  };
}

async function scoreTrial(trial: { id: string; risk: string; caseSnapshot: string; trace: (Parameters<typeof fromRecord>[0] & { id: string }) | null }) {
  const evalCase = parse<EvalCase>(trial.caseSnapshot, {} as EvalCase);
  if (!trial.trace) return { evalCase, verdict: "no_trace" as const, ruleVerdict: "no_trace" as const, llmVerdict: "skipped" as const, reason: "Trial 未产生可评分 Trace", traceId: undefined };
  const trace = fromRecord(trial.trace);
  const rules = evalCase.judge.rules?.length ? evalCase.judge.rules : [{ type: "tool_call_match" }, { type: "state_diff_check" }, { type: "safety_check" }, { type: "efficiency_check" }];
  const ruleResults = runRuleScorer(trace, evalCase.expected, rules);
  const ruleAggregate = aggregateResults(ruleResults);
  const dimensions = evalCase.judge.llmJudge?.criteria?.map((item) => String(item.name ?? "语义质量")) ?? [];
  const judgeEnabled = (evalCase.judge.strategy === "llm" || evalCase.judge.strategy === "hybrid") && evalCase.judge.llmJudge?.enabled && dimensions.length;
  const llmResults = judgeEnabled ? await runLlmJudge(trace, dimensions) : [];
  const llmAggregate = aggregateLlmResults(llmResults);
  let verdict: ScorerVerdict = ruleAggregate.verdict;
  let reason = ruleAggregate.reason;
  if (evalCase.judge.strategy === "human") {
    verdict = "skipped";
    reason = "该用例要求人工终判";
  } else if (ruleAggregate.verdict === "pass" && llmAggregate.verdict === "fail") {
    verdict = "fail";
    reason = `规则通过但 Judge 语义失败：${llmAggregate.reason}`;
  } else if (ruleAggregate.verdict === "pass" && llmAggregate.verdict === "soft_pass") {
    verdict = "soft_pass";
    reason = `规则通过，Judge 给出软通过：${llmAggregate.reason}`;
  }
  if (evalCase.risk === "P0" && verdict !== "pass") verdict = "fail";
  await prisma.annotation.deleteMany({ where: { trialId: trial.id, scorerType: { in: ["rule", "llm", "hybrid"] } } });
  for (const result of ruleResults) {
    await prisma.annotation.create({ data: { traceRecordId: trial.trace.id, trialId: trial.id, targetLevel: "trace", scorerType: "rule", ruleType: result.ruleType, verdict: result.verdict, reason: result.reason, details: result.details ? JSON.stringify(result.details) : null, problemCategory: verdict === "fail" ? evalCase.category : null, phenomenon: verdict === "fail" ? reason : null } });
  }
  const conflict = ruleAggregate.verdict !== "fail" && llmAggregate.verdict === "fail";
  const needsHumanReview = evalCase.judge.strategy === "human" || conflict || (evalCase.risk === "P0" && verdict === "fail");
  const aggregate = await prisma.annotation.create({ data: { traceRecordId: trial.trace.id, trialId: trial.id, targetLevel: "trace", scorerType: judgeEnabled ? "hybrid" : "rule", verdict, reason, confidence: llmResults.length ? Math.min(...llmResults.map((item) => Math.abs(item.score - 0.5) * 2)) : 1, score: llmResults.length ? llmResults.reduce((sum, item) => sum + item.score, 0) / llmResults.length : null, issueType: conflict ? "rule_judge_conflict" : null, problemCategory: verdict === "fail" ? evalCase.category : null, phenomenon: verdict === "fail" ? reason : null, needsHumanReview } });
  if (needsHumanReview) await prisma.humanReviewTask.create({ data: { annotationId: aggregate.id, trialId: trial.id, reason: conflict ? "规则与 Judge 结论冲突" : evalCase.judge.strategy === "human" ? "用例要求人工终判" : "P0 失败需人工复核", proposedVerdict: verdict } });
  return { evalCase, verdict, ruleVerdict: ruleAggregate.verdict, llmVerdict: llmAggregate.verdict, reason, traceId: trace.traceId, usage: trace.usage };
}

export async function scoreRun(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { trials: { include: { trace: true }, orderBy: [{ caseId: "asc" }, { attempt: "asc" }] } } });
  if (!run) throw new Error("Run 不存在");
  await prisma.run.update({ where: { id: runId }, data: { status: "scoring" } });
  const results = await Promise.all(run.trials.map(scoreTrial));
  const grouped = new Map<string, typeof results>();
  for (const result of results) grouped.set(result.evalCase.id, [...(grouped.get(result.evalCase.id) ?? []), result]);
  const caseResults: CaseResult[] = [...grouped.entries()].map(([caseId, entries]) => {
    const first = entries[0];
    const passes = entries.filter((item) => item.verdict === "pass" || item.verdict === "soft_pass").length;
    const consistency = first.evalCase.judge.consistency;
    const requireAll = consistency?.requireConsecutive ?? false;
    const finalVerdict: ScorerVerdict = requireAll ? (passes === entries.length ? "pass" : "fail") : (passes ? "pass" : entries.some((item) => item.verdict === "no_trace") ? "no_trace" : "fail");
    return { caseId, risk: first.evalCase.risk, category: first.evalCase.category, scenario: first.evalCase.scenario, verdict: finalVerdict, ruleVerdict: first.ruleVerdict, llmVerdict: first.llmVerdict, reason: entries.map((item) => item.reason).join(" | "), traceId: first.traceId, usage: first.usage, consistency: { runs: entries.length, passes, passRate: entries.length ? passes / entries.length : 0, passAtK: passes > 0, passToK: passes === entries.length } };
  });
  const gate = evaluateGate(caseResults);
  const counted = caseResults.filter((item) => item.verdict !== "skipped");
  const summary = { totalCases: caseResults.length, scored: counted.length, pass: caseResults.filter((item) => item.verdict === "pass").length, fail: caseResults.filter((item) => item.verdict === "fail" || item.verdict === "no_trace").length, noTrace: caseResults.filter((item) => item.verdict === "no_trace").length, passRate: counted.length ? caseResults.filter((item) => item.verdict === "pass").length / counted.length : 0, caseResults };
  await prisma.run.update({ where: { id: runId }, data: { status: "completed", gatePassed: gate.passed, gateResult: JSON.stringify(gate), summary: JSON.stringify(summary), finishedAt: new Date() } });
  await identifyBadcases(runId);
  return { summary, gate, caseResults };
}

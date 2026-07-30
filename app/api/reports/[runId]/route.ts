import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ runId: string }> };

function parse<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { runId } = await params;
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { trials: { include: { trace: true } } } });
    if (!run) return NextResponse.json(fail("Run 不存在"), { status: 404 });
    const summary = parse(run.summary, { totalCases: 0, caseResults: [] as Array<Record<string, unknown>> });
    const gate = parse(run.gateResult, { passed: run.gatePassed ?? false });
    const traces = run.trials.flatMap((trial) => trial.trace ? [trial.trace] : []);
    const usage = traces.map((trace) => parse(trace.usage, {} as { latencyMs?: number; totalTokens?: number; costCny?: number; toolCalls?: number }));
    const latency = usage.map((item) => item.latencyMs ?? 0).filter(Boolean);
    const tokens = usage.map((item) => item.totalTokens ?? 0).filter(Boolean);
    const costs = usage.map((item) => item.costCny ?? 0).filter(Boolean);
    const completed = run.trials.filter((trial) => trial.status === "completed").length;
    return NextResponse.json(ok({
      run: { id: run.id, agentId: run.agentId, source: run.source, mode: run.mode, status: run.status, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt },
      summary,
      gate,
      stability: (summary.caseResults as Array<{ consistency?: unknown }>).map((item) => ({ caseId: item.caseId, consistency: item.consistency })),
      resources: { trials: run.trials.length, completed, p50LatencyMs: percentile(latency, 0.5), p95LatencyMs: percentile(latency, 0.95), p99LatencyMs: percentile(latency, 0.99), avgTokens: tokens.length ? tokens.reduce((sum, item) => sum + item, 0) / tokens.length : 0, totalCostCny: costs.reduce((sum, item) => sum + item, 0) },
      trials: run.trials.map((trial) => ({ id: trial.id, caseId: trial.caseId, risk: trial.risk, scenario: trial.scenario, attempt: trial.attempt, status: trial.status, durationMs: trial.trace?.durationMs ?? null, traceId: trial.trace?.traceId ?? null, errorMessage: trial.errorMessage })),
      topClusters: await prisma.problemCluster.findMany({ where: { agentId: run.agentId, status: "open" }, orderBy: { size: "desc" }, take: 10 }),
    }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

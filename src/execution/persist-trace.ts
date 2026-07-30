import { getAdapter } from "@/adapters";
import { prisma } from "@/lib/prisma";
import type { ExecutionEnvelope, NormalizedTrace } from "@/types";

export async function persistNormalizedTrace(trace: NormalizedTrace, eventKey?: string) {
  const key = eventKey ?? trace.eventKey ?? `${trace.trialId ?? "manual"}:${trace.traceId}`;
  return prisma.traceRecord.upsert({
    where: { eventKey: key },
    create: {
      traceId: trace.traceId,
      eventKey: key,
      sessionId: trace.sessionId,
      turnId: trace.turnId,
      agentType: trace.agentType,
      agentId: trace.agentId,
      skillId: trace.skillId,
      caseId: trace.caseId,
      source: trace.source,
      runId: trace.runId,
      trialId: trace.trialId,
      input: JSON.stringify(trace.input),
      spans: JSON.stringify(trace.spans),
      outcome: JSON.stringify(trace.outcome),
      stateBefore: trace.stateBefore ? JSON.stringify(trace.stateBefore) : null,
      stateAfter: trace.stateAfter ? JSON.stringify(trace.stateAfter) : null,
      usage: JSON.stringify(trace.usage),
      versions: JSON.stringify(trace.versions),
      meta: trace.meta ? JSON.stringify(trace.meta) : null,
      startTime: new Date(trace.startTime),
      durationMs: trace.durationMs,
    },
    update: {},
  });
}

export async function persistExecutionEnvelope(envelope: ExecutionEnvelope) {
  const trial = await prisma.runTrial.findUnique({ where: { id: envelope.trialId }, include: { run: true } });
  if (!trial || trial.runId !== envelope.runId || trial.caseId !== envelope.caseId || trial.run.agentId !== envelope.agentId) {
    throw new Error("执行结果与 Trial 上下文不匹配");
  }
  const adapter = getAdapter(envelope.agentId);
  if (!adapter) throw new Error(`未找到 ${envelope.agentId} 的 TraceAdapter`);
  const trace = adapter.toNormalizedTrace(envelope.rawTrace);
  trace.eventKey = envelope.eventKey;
  trace.agentId = envelope.agentId;
  trace.runId = envelope.runId;
  trace.trialId = envelope.trialId;
  trace.caseId = envelope.caseId;
  trace.source = "eval";
  const record = await persistNormalizedTrace(trace, envelope.eventKey);
  await prisma.runTrial.update({
    where: { id: trial.id },
    data: { status: "completed", finishedAt: new Date(), cleanupStatus: envelope.cleanup?.status ?? "pending" },
  });
  return record;
}

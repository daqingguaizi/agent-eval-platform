import { NextRequest, NextResponse } from "next/server";
import { inspectDataset } from "@/lib/fs-store";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { scoreRun } from "@/scorers/router";

export async function POST(request: NextRequest) {
  try {
    const { traceRecordId, datasetFile, caseId } = await request.json() as { traceRecordId?: string; datasetFile?: string; caseId?: string };
    if (!traceRecordId || !datasetFile || !caseId) return NextResponse.json(fail("缺少 traceRecordId、datasetFile 或 caseId"), { status: 400 });
    const sourceTrace = await prisma.traceRecord.findUnique({ where: { id: traceRecordId } });
    if (!sourceTrace || sourceTrace.source !== "production") return NextResponse.json(fail("仅可回放已授权的生产 Trace"), { status: 400 });
    const dataset = await inspectDataset(datasetFile);
    const evalCase = dataset.cases.find((item) => item.id === caseId && item.agent === sourceTrace.agentId);
    if (!evalCase) return NextResponse.json(fail("评测集未找到与生产 Trace 对应的 Case"), { status: 400 });
    const index = await prisma.dataset.upsert({ where: { agentId_filePath: { agentId: sourceTrace.agentId, filePath: datasetFile } }, create: { agentId: sourceTrace.agentId, filePath: datasetFile, split: dataset.split, version: dataset.contentHash.slice(0, 12), contentHash: dataset.contentHash, caseCount: dataset.cases.length }, update: { contentHash: dataset.contentHash, caseCount: dataset.cases.length } });
    const run = await prisma.run.create({ data: { agentId: sourceTrace.agentId, datasetId: index.id, source: "replay", mode: "replay", status: "executed", configuration: JSON.stringify({ datasetFile, replayOf: sourceTrace.traceId }) } });
    const trial = await prisma.runTrial.create({ data: { runId: run.id, caseId, caseSnapshot: JSON.stringify(evalCase), risk: evalCase.risk, scenario: evalCase.scenario, attempt: 1, executorType: "replay", status: "completed", cleanupStatus: "not_required", startedAt: new Date(), finishedAt: new Date() } });
    await prisma.traceRecord.create({ data: { traceId: `replay-${sourceTrace.traceId}-${run.id}`, eventKey: `replay:${run.id}`, sessionId: sourceTrace.sessionId, turnId: sourceTrace.turnId, agentType: sourceTrace.agentType, agentId: sourceTrace.agentId, skillId: sourceTrace.skillId, caseId, source: "replay", runId: run.id, trialId: trial.id, input: sourceTrace.input, spans: sourceTrace.spans, outcome: sourceTrace.outcome, stateBefore: sourceTrace.stateBefore, stateAfter: sourceTrace.stateAfter, usage: sourceTrace.usage, versions: sourceTrace.versions, meta: sourceTrace.meta, startTime: sourceTrace.startTime, durationMs: sourceTrace.durationMs } });
    const scored = await scoreRun(run.id);
    return NextResponse.json(ok({ runId: run.id, ...scored }), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

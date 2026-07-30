import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { parseJsonObject, verifyCallbackSignature } from "@/lib/request-validation";
import { persistExecutionEnvelope } from "@/execution/persist-trace";
import { refreshRunStatus } from "@/execution/run-orchestrator";
import { scoreRun } from "@/scorers/router";
import type { ExecutionEnvelope } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const envelope = parseJsonObject(rawBody) as unknown as ExecutionEnvelope | null;
    if (!envelope || envelope.protocolVersion !== "v1" || !envelope.eventKey || !envelope.trialId || !envelope.runId || !envelope.caseId || !envelope.agentId) {
      return NextResponse.json(fail("回调 envelope 缺少 v1 协议必填字段"), { status: 400 });
    }
    const trial = await prisma.runTrial.findUnique({ where: { id: envelope.trialId }, include: { run: { include: { connection: true } } } });
    if (!trial || trial.runId !== envelope.runId || trial.caseId !== envelope.caseId || trial.run.agentId !== envelope.agentId) return NextResponse.json(fail("回调 Trial 与运行上下文不匹配"), { status: 404 });
    const secret = trial.run.connection?.secretEnvRef ? process.env[trial.run.connection.secretEnvRef] : undefined;
    const signatureError = verifyCallbackSignature(request.headers, rawBody, secret);
    if (signatureError) return NextResponse.json(fail(signatureError), { status: 401 });
    const record = await persistExecutionEnvelope(envelope);
    const status = await refreshRunStatus(trial.runId);
    if (status.run.status === "executed") await scoreRun(trial.runId);
    return NextResponse.json(ok({ traceId: record.traceId, trialId: trial.id, runStatus: status.run.status }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdapter } from "@/adapters";
import { fail, ok } from "@/lib/api-response";
import { persistNormalizedTrace } from "@/execution/persist-trace";
import { validateIngestStandards, type IngestValidation } from "@/ops/ingest";
import { prisma } from "@/lib/prisma";

const SENSITIVE_KEYS = /password|token|secret|authorization|cookie|email|phone|mobile|idcard/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(item)]));
}
function validSignature(request: NextRequest, body: string) {
  const secret = process.env.PRODUCTION_INGEST_SECRET;
  const timestamp = request.headers.get("x-eval-timestamp");
  const nonce = request.headers.get("x-eval-nonce");
  const signature = request.headers.get("x-eval-signature");
  if (!secret || !timestamp || !nonce || !signature || Math.abs(Date.now() - Number(timestamp)) > 300000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
  const given = Buffer.from(signature, "hex");
  const target = Buffer.from(expected, "hex");
  return given.length === target.length && timingSafeEqual(given, target);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (!validSignature(request, rawBody)) return NextResponse.json(fail("生产采集签名无效或已过期"), { status: 401 });
    const body = JSON.parse(rawBody) as { eventKey?: string; authorizationRef?: string; sourceSystem?: string; agentId?: string; raw?: unknown; validation?: IngestValidation };
    if (!body.eventKey || !body.authorizationRef || !body.sourceSystem || !body.agentId || !body.raw || !body.validation) return NextResponse.json(fail("缺少 eventKey、authorizationRef、sourceSystem、agentId、raw 或 validation"), { status: 400 });
    const standards = validateIngestStandards(body.validation);
    if (!standards.passed) return NextResponse.json(ok({ accepted: false, violations: standards.violations }));
    if (await prisma.productionIngestEvent.findUnique({ where: { eventKey: body.eventKey } })) return NextResponse.json(ok({ accepted: false, violations: ["重复事件"], idempotent: true }));
    const adapter = getAdapter(body.agentId);
    if (!adapter) return NextResponse.json(fail(`未找到 ${body.agentId} 的 TraceAdapter`), { status: 400 });
    const trace = adapter.toNormalizedTrace(redact(body.raw));
    trace.eventKey = body.eventKey;
    trace.agentId = body.agentId;
    trace.source = "production";
    trace.meta = { ...trace.meta, authorizationRef: body.authorizationRef, sourceSystem: body.sourceSystem, ingestValidation: body.validation };
    const record = await persistNormalizedTrace(trace, body.eventKey);
    await prisma.productionIngestEvent.create({ data: { eventKey: body.eventKey, traceRecordId: record.id, authorizationRef: body.authorizationRef, signatureValid: true, redactionResult: JSON.stringify({ applied: true }), sourceSystem: body.sourceSystem } });
    return NextResponse.json(ok({ accepted: true, traceId: record.traceId, id: record.id }), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const agentId = new URL(request.url).searchParams.get("agentId");
    const traces = await prisma.traceRecord.findMany({ where: { source: "production", ...(agentId ? { agentId } : {}) }, select: { id: true, traceId: true, agentId: true, sessionId: true, createdAt: true, meta: true }, orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json(ok({ total: traces.length, recent: traces.map((trace) => ({ ...trace, meta: trace.meta ? JSON.parse(trace.meta) : null })) }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

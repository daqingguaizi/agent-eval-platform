import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAdapter } from "@/adapters";
import type { NormalizedTrace, TraceSource } from "@/types/normalized-trace";

/** GET /api/traces — 列出 trace 记录（支持 ?source=&agentId=&sessionId= 筛选） */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source") as TraceSource | null;
    const agentId = url.searchParams.get("agentId");
    const sessionId = url.searchParams.get("sessionId");
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") ?? "20", 10);

    const where: Record<string, unknown> = {};
    if (source) where.source = source;
    if (agentId) where.agentId = agentId;
    if (sessionId) where.sessionId = sessionId;

    const [total, records] = await Promise.all([
      prisma.traceRecord.count({ where }),
      prisma.traceRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const traces = records.map((r) => ({
      ...r,
      input: JSON.parse(r.input),
      spans: JSON.parse(r.spans),
      outcome: JSON.parse(r.outcome),
      stateBefore: r.stateBefore ? JSON.parse(r.stateBefore) : null,
      stateAfter: r.stateAfter ? JSON.parse(r.stateAfter) : null,
      meta: r.meta ? JSON.parse(r.meta) : null,
    }));

    return NextResponse.json(ok({ total, page, pageSize, traces }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/**
 * POST /api/traces — 导入 trace
 *
 * 支持两种模式：
 * 1. 原始模式：{ agentId, source?, raw } → 经 adapter 归一化后存 DB
 * 2. 归一化模式：{ normalized: NormalizedTrace } → 直接存 DB
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let trace: NormalizedTrace;

    if (body.normalized) {
      // 归一化模式：直接接收
      trace = body.normalized as NormalizedTrace;
    } else if (body.agentId && body.raw) {
      // 原始模式：经 adapter 转换
      const adapter = getAdapter(body.agentId);
      if (!adapter) {
        return NextResponse.json(
          fail(`未找到 agentId="${body.agentId}" 的 adapter`),
          { status: 400 }
        );
      }
      trace = adapter.toNormalizedTrace(body.raw);
      // 允许调用方覆盖 source
      if (body.source) {
        trace.source = body.source;
      }
    } else {
      return NextResponse.json(
        fail("请提供 { agentId, raw } 或 { normalized }"),
        { status: 400 }
      );
    }

    // 检查 traceId 唯一
    const existing = await prisma.traceRecord.findUnique({
      where: { traceId: trace.traceId },
    });
    if (existing) {
      return NextResponse.json(
        fail(`traceId "${trace.traceId}" 已存在`),
        { status: 409 }
      );
    }

    // 确保 agent 存在
    const agent = await prisma.agent.findUnique({
      where: { id: trace.agentId ?? "unknown" },
    });

    const record = await prisma.traceRecord.create({
      data: {
        traceId: trace.traceId,
        agentId: trace.agentId ?? "unknown",
        runId: trace.runId ?? null,
        sessionId: trace.sessionId,
        turnId: trace.turnId,
        source: trace.source,
        agentType: trace.agentType,
        input: JSON.stringify(trace.input),
        spans: JSON.stringify(trace.spans),
        outcome: JSON.stringify(trace.outcome),
        stateBefore: trace.stateBefore
          ? JSON.stringify(trace.stateBefore)
          : null,
        stateAfter: trace.stateAfter
          ? JSON.stringify(trace.stateAfter)
          : null,
        meta: trace.meta ? JSON.stringify(trace.meta) : null,
        // 只有 agent 存在时才关联
        ...(agent ? {} : {}),
      },
    });

    return NextResponse.json(
      ok({
        id: record.id,
        traceId: record.traceId,
        agentId: record.agentId,
        source: record.source,
        spanCount: trace.spans.length,
      }),
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";

/**
 * GET /api/annotations — 列出标注
 * 支持筛选: ?traceRecordId=&scorerType=&verdict=&targetLevel=&needsHumanReview=&spotChecked=
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const traceRecordId = url.searchParams.get("traceRecordId");
    const scorerType = url.searchParams.get("scorerType");
    const verdict = url.searchParams.get("verdict");
    const targetLevel = url.searchParams.get("targetLevel");
    const needsHumanReview = url.searchParams.get("needsHumanReview");
    const spotChecked = url.searchParams.get("spotChecked");
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10);

    const where: Record<string, unknown> = {};
    if (traceRecordId) where.traceRecordId = traceRecordId;
    if (scorerType) where.scorerType = scorerType;
    if (verdict) where.verdict = verdict;
    if (targetLevel) where.targetLevel = targetLevel;
    if (needsHumanReview) where.needsHumanReview = needsHumanReview === "true";
    if (spotChecked) where.spotChecked = spotChecked === "true";

    const [total, records] = await Promise.all([
      prisma.annotation.count({ where }),
      prisma.annotation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { trace: { select: { traceId: true, agentId: true, input: true, sessionId: true } } },
      }),
    ]);

    const annotations = records.map((a) => ({
      ...a,
      humanOverride: a.humanOverride ? JSON.parse(a.humanOverride) : null,
      trace: {
        ...a.trace,
        input: JSON.parse(a.trace.input),
      },
    }));

    return NextResponse.json(ok({ total, page, pageSize, annotations }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/**
 * POST /api/annotations — 创建标注（规则/LLM/人工）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      traceRecordId,
      targetLevel,
      scorerType,
      verdict,
      problemCategory,
      phenomenon,
      confidence,
      reason,
      needsHumanReview,
    } = body as {
      traceRecordId: string;
      targetLevel: string;
      scorerType: string;
      verdict: string;
      problemCategory?: string;
      phenomenon?: string;
      confidence?: number;
      reason?: string;
      needsHumanReview?: boolean;
    };

    if (!traceRecordId || !targetLevel || !scorerType || !verdict) {
      return NextResponse.json(
        fail("缺少必填字段：traceRecordId, targetLevel, scorerType, verdict"),
        { status: 400 }
      );
    }

    // 验证 trace 存在
    const trace = await prisma.traceRecord.findUnique({
      where: { id: traceRecordId },
    });
    if (!trace) {
      return NextResponse.json(fail("traceRecordId 不存在"), { status: 404 });
    }

    const annotation = await prisma.annotation.create({
      data: {
        traceRecordId,
        targetLevel,
        scorerType,
        verdict,
        problemCategory: problemCategory ?? null,
        phenomenon: phenomenon ?? null,
        confidence: confidence ?? null,
        reason: reason ?? null,
        needsHumanReview: needsHumanReview ?? false,
      },
    });

    return NextResponse.json(ok(annotation), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json() as { verdict?: "pass" | "soft_pass" | "fail"; evidence?: string; reviewerId?: string };
    if (!body.verdict || !body.evidence) return NextResponse.json(fail("缺少 verdict 或 evidence"), { status: 400 });
    const task = await prisma.humanReviewTask.findUnique({ where: { id }, include: { annotation: true } });
    if (!task) return NextResponse.json(fail("审核任务不存在"), { status: 404 });
    await prisma.$transaction([
      prisma.humanReviewTask.update({ where: { id }, data: { status: "resolved", resolvedVerdict: body.verdict, evidence: body.evidence, reviewerId: body.reviewerId, resolvedAt: new Date() } }),
      ...(task.annotation ? [prisma.annotation.update({ where: { id: task.annotation.id }, data: { humanOverride: JSON.stringify({ verdict: body.verdict, evidence: body.evidence }), reviewerId: body.reviewerId, spotChecked: true, needsHumanReview: false } })] : []),
    ]);
    return NextResponse.json(ok({ id, status: "resolved", verdict: body.verdict }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

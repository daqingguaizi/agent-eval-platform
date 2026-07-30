import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    const status = query.get("status") ?? "pending";
    const tasks = await prisma.humanReviewTask.findMany({ where: { status }, include: { annotation: { include: { trace: { select: { traceId: true, input: true, outcome: true } } } }, trial: { select: { caseId: true, risk: true, runId: true } } }, orderBy: { createdAt: "asc" }, take: 100 });
    return NextResponse.json(ok(tasks.map((task) => ({ ...task, annotation: task.annotation ? { ...task.annotation, trace: { ...task.annotation.trace, input: JSON.parse(task.annotation.trace.input), outcome: JSON.parse(task.annotation.trace.outcome) } } : null }))));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

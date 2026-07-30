import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { reason } = await request.json().catch(() => ({ reason: "用户取消" })) as { reason?: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return NextResponse.json(fail("Run 不存在"), { status: 404 });
    if (["executed", "scored", "completed", "cancelled"].includes(run.status)) return NextResponse.json(fail("当前 Run 不可取消"), { status: 400 });
    await prisma.$transaction([
      prisma.run.update({ where: { id }, data: { status: "cancelled", cancellationReason: reason ?? "用户取消", finishedAt: new Date() } }),
      prisma.runTrial.updateMany({ where: { runId: id, status: { in: ["queued", "running"] } }, data: { status: "cancelled", cleanupStatus: "pending", finishedAt: new Date() } }),
    ]);
    return NextResponse.json(ok({ runId: id, status: "cancelled" }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        dataset: true,
        connection: { select: { id: true, protocol: true, status: true } },
        trials: {
          include: {
            trace: { select: { id: true, traceId: true, durationMs: true } },
          },
          orderBy: [{ caseId: "asc" }, { attempt: "asc" }],
        },
      },
    });
    if (!run) return NextResponse.json(fail("Run 不存在"), { status: 404 });
    return NextResponse.json(
      ok({
        ...run,
        configuration: JSON.parse(run.configuration),
        summary: run.summary ? JSON.parse(run.summary) : null,
        gateResult: run.gateResult ? JSON.parse(run.gateResult) : null,
      })
    );
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

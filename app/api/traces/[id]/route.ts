import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

/** GET /api/traces/:id — 单条 trace 详情 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const record = await prisma.traceRecord.findFirst({
      where: { OR: [{ id }, { traceId: id }] },
      include: { annotations: true, badcase: true },
    });

    if (!record) {
      return NextResponse.json(fail("Trace 不存在"), { status: 404 });
    }

    return NextResponse.json(
      ok({
        ...record,
        input: JSON.parse(record.input),
        spans: JSON.parse(record.spans),
        outcome: JSON.parse(record.outcome),
        stateBefore: record.stateBefore
          ? JSON.parse(record.stateBefore)
          : null,
        stateAfter: record.stateAfter
          ? JSON.parse(record.stateAfter)
          : null,
        meta: record.meta ? JSON.parse(record.meta) : null,
        annotations: record.annotations.map((a) => ({
          ...a,
          humanOverride: a.humanOverride
            ? JSON.parse(a.humanOverride)
            : null,
        })),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

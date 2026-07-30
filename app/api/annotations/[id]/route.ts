import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/annotations/:id — 人工抽查覆盖（spot-check）
 * 设置 spotChecked=true，写入 humanOverride
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { humanOverride, spotChecked } = body as {
      humanOverride?: { verdict: string; reason: string };
      spotChecked?: boolean;
    };

    const existing = await prisma.annotation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(fail("标注不存在"), { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (spotChecked !== undefined) updateData.spotChecked = spotChecked;
    if (humanOverride) {
      updateData.humanOverride = JSON.stringify(humanOverride);
      updateData.spotChecked = true;
    }

    const updated = await prisma.annotation.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(
      ok({
        ...updated,
        humanOverride: updated.humanOverride
          ? JSON.parse(updated.humanOverride)
          : null,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** DELETE /api/annotations/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await prisma.annotation.delete({ where: { id } });
    return NextResponse.json(ok(null, "已删除"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

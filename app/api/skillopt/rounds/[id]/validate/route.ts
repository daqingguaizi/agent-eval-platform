import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordRejectedEdit } from "@/skillopt/rejected-buffer";
import { validateSkillOptRound } from "@/skillopt/validation-gate";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { validationRunId } = await request.json() as { validationRunId?: string };
    if (!validationRunId) return NextResponse.json(fail("缺少 validationRunId"), { status: 400 });
    const round = await validateSkillOptRound(id, validationRunId);
    const result = round.result ? JSON.parse(round.result) : {};
    if (round.status === "rejected") await recordRejectedEdit(round.id, round.skillId ?? undefined, JSON.parse(round.candidateEdits), "Validation Gate 未通过", result);
    return NextResponse.json(ok({ ...round, candidateEdits: JSON.parse(round.candidateEdits), result }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

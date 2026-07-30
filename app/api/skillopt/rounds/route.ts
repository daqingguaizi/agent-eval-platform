import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { applyBoundedEdits, type BoundedEdit, validateBoundedEdits } from "@/skillopt/bounded-edit";
import { collectRolloutEvidence } from "@/skillopt/rollout";
import { reflectEvidence } from "@/skillopt/reflect";

export async function GET(request: NextRequest) {
  try {
    const agentId = new URL(request.url).searchParams.get("agentId");
    const rounds = await prisma.skillOptRound.findMany({ where: agentId ? { agentId } : {}, orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json(ok(rounds.map((round) => ({ ...round, candidateEdits: JSON.parse(round.candidateEdits), result: round.result ? JSON.parse(round.result) : null }))));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { agentId?: string; skillId?: string; skillPath?: string; trainRunId?: string; edits?: BoundedEdit[]; apply?: boolean };
    if (!body.agentId || !body.trainRunId || !body.edits) return NextResponse.json(fail("缺少 agentId、trainRunId 或 edits"), { status: 400 });
    const validation = validateBoundedEdits(body.edits);
    if (validation) return NextResponse.json(fail(validation), { status: 400 });
    const evidence = await collectRolloutEvidence(body.trainRunId);
    if (evidence.agentId !== body.agentId) return NextResponse.json(fail("Train Run 与 Agent 不匹配"), { status: 400 });
    const reflection = reflectEvidence(evidence);
    if (body.apply && body.skillPath) await applyBoundedEdits(body.skillPath, body.edits);
    const round = await prisma.skillOptRound.create({ data: { agentId: body.agentId, skillId: body.skillId, trainRunId: body.trainRunId, status: body.apply ? "pending_validation" : "draft", candidateEdits: JSON.stringify(body.edits), result: JSON.stringify({ evidence: reflection, applied: Boolean(body.apply) }) } });
    return NextResponse.json(ok({ ...round, candidateEdits: body.edits, reflection }), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

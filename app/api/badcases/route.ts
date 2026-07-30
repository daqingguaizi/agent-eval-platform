import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { clusterBadcases, identifyBadcases } from "@/rca";

export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    const badcases = await prisma.badcase.findMany({
      where: { ...(query.get("status") ? { status: query.get("status")! } : {}), ...(query.get("clusterId") ? { clusterId: query.get("clusterId")! } : {}), ...(query.get("agentId") ? { trace: { agentId: query.get("agentId")! } } : {}) },
      include: { trace: { select: { traceId: true, agentId: true, input: true, outcome: true, sessionId: true } }, cluster: true, rca: true, trial: { select: { caseId: true, risk: true, scenario: true, runId: true } } },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    return NextResponse.json(ok(badcases.map((item) => ({
      ...item,
      triageResult: item.triageResult ? JSON.parse(item.triageResult) : null,
      trace: item.trace ? { ...item.trace, input: JSON.parse(item.trace.input), outcome: JSON.parse(item.trace.outcome) } : null,
      rca: item.rca ? { ...item.rca, candidateModules: JSON.parse(item.rca.candidateModules), moduleDiagnosis: JSON.parse(item.rca.moduleDiagnosis), fixActions: JSON.parse(item.rca.fixActions) } : null,
    }))));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { agentId, runId } = await request.json() as { agentId?: string; runId?: string };
    if (!agentId) return NextResponse.json(fail("缺少 agentId"), { status: 400 });
    const identified = await identifyBadcases(runId);
    const clustered = await clusterBadcases(agentId);
    return NextResponse.json(ok({ identified: identified.length, ...clustered }), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

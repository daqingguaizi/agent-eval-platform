import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ runId: string }> };
type CaseResult = { caseId: string; verdict: string };

function parse(value: string | null): { caseResults?: CaseResult[] } {
  try { return value ? JSON.parse(value) as { caseResults?: CaseResult[] } : {}; } catch { return {}; }
}
function passed(verdict?: string) { return verdict === "pass" || verdict === "soft_pass"; }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { runId } = await params;
    const requestedBaseline = new URL(request.url).searchParams.get("baselineRunId");
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json(fail("Run 不存在"), { status: 404 });
    const baselineId = requestedBaseline ?? run.baselineRunId;
    if (!baselineId) return NextResponse.json(fail("请提供 baselineRunId 或先为 Run 绑定基线"), { status: 400 });
    const baseline = await prisma.run.findUnique({ where: { id: baselineId } });
    if (!baseline || baseline.agentId !== run.agentId) return NextResponse.json(fail("基线 Run 不存在或 Agent 不一致"), { status: 400 });
    const currentCases = new Map(parse(run.summary).caseResults?.map((item) => [item.caseId, item]) ?? []);
    const baselineCases = new Map(parse(baseline.summary).caseResults?.map((item) => [item.caseId, item]) ?? []);
    const quadrants = { stablePass: [] as string[], fixed: [] as string[], regressed: [] as string[], persistentFail: [] as string[] };
    for (const [caseId, current] of currentCases) {
      const old = baselineCases.get(caseId);
      if (!old) continue;
      if (passed(old.verdict) && passed(current.verdict)) quadrants.stablePass.push(caseId);
      else if (!passed(old.verdict) && passed(current.verdict)) quadrants.fixed.push(caseId);
      else if (passed(old.verdict) && !passed(current.verdict)) quadrants.regressed.push(caseId);
      else quadrants.persistentFail.push(caseId);
    }
    return NextResponse.json(ok({ runId, baselineRunId: baselineId, quadrants, pairedCases: quadrants.stablePass.length + quadrants.fixed.length + quadrants.regressed.length + quadrants.persistentFail.length, hasRegression: quadrants.regressed.length > 0, recommendation: quadrants.regressed.length ? "存在新增回归，建议阻断发布或回滚" : "未发现配对新增回归" }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

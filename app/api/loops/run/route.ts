import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { generateSpecDraft, loadLoopConfig, triageClusters } from "@/ops/loop";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { agentId?: string; actions?: Array<"triage" | "spec" | "verify">; clusterId?: string; validationRunId?: string };
    if (!body.agentId) return NextResponse.json(fail("缺少 agentId"), { status: 400 });
    const actions = body.actions ?? ["triage"];
    const result: Record<string, unknown> = {};
    if (actions.includes("triage")) result.triage = await triageClusters(body.agentId, await loadLoopConfig(body.agentId));
    if (actions.includes("spec")) {
      const candidates = (result.triage as Array<{ clusterId: string; decision: string }> | undefined) ?? (body.clusterId ? [{ clusterId: body.clusterId, decision: "needs-fix" }] : []);
      result.specs = await Promise.all(candidates.filter((item) => item.decision === "needs-fix").map((item) => generateSpecDraft(item.clusterId, body.agentId!)));
    }
    if (actions.includes("verify")) {
      if (!body.clusterId || !body.validationRunId) return NextResponse.json(fail("验证需要 clusterId 和 validationRunId"), { status: 400 });
      const run = await prisma.run.findUnique({ where: { id: body.validationRunId } });
      if (!run || run.agentId !== body.agentId || run.status !== "completed") return NextResponse.json(fail("Validation Run 不存在、未完成或 Agent 不匹配"), { status: 400 });
      const verified = Boolean(run.gatePassed);
      await prisma.problemCluster.update({ where: { id: body.clusterId }, data: { status: verified ? "verified" : "reopened" } });
      result.verification = { clusterId: body.clusterId, validationRunId: run.id, verified, gatePassed: run.gatePassed };
    }
    return NextResponse.json(ok(result));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

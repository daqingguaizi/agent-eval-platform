import { prisma } from "@/lib/prisma";

export async function collectRolloutEvidence(trainRunId: string) {
  const run = await prisma.run.findUnique({ where: { id: trainRunId } });
  if (!run || run.status !== "completed") throw new Error("Train Run 必须已完成");
  const summary = run.summary ? JSON.parse(run.summary) as { caseResults?: unknown[] } : {};
  return { trainRunId, agentId: run.agentId, caseResults: summary.caseResults ?? [] };
}

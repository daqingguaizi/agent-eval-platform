import { prisma } from "@/lib/prisma";

export async function validateSkillOptRound(roundId: string, validationRunId: string) {
  const [round, run] = await Promise.all([prisma.skillOptRound.findUnique({ where: { id: roundId } }), prisma.run.findUnique({ where: { id: validationRunId } })]);
  if (!round || !run || run.status !== "completed") throw new Error("优化轮次或已完成的 Validation Run 不存在");
  const accepted = Boolean(run.gatePassed);
  return prisma.skillOptRound.update({ where: { id: roundId }, data: { validationRunId, status: accepted ? "accepted" : "rejected", result: JSON.stringify({ accepted, gatePassed: run.gatePassed, gateResult: run.gateResult }) } });
}

import { prisma } from "@/lib/prisma";

export async function recordRejectedEdit(roundId: string, skillId: string | undefined, edit: unknown, reason: string, validationResult: unknown) {
  return prisma.rejectedEdit.create({ data: { skillOptRoundId: roundId, skillId, edit: JSON.stringify(edit), reason, validationResult: JSON.stringify(validationResult) } });
}

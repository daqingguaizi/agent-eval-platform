import { prisma } from "@/lib/prisma";

export interface RcaInput {
  badcaseId: string;
  responsibleModule: string;
  problemCategory: string;
  problemEnum: string;
  confidence?: number;
  evidence?: string;
  report?: string;
  owner?: string;
  fixActions: Array<Record<string, unknown>>;
  specPath?: string;
}

export async function identifyBadcases(runId?: string) {
  const annotations = await prisma.annotation.findMany({
    where: { verdict: "fail", ...(runId ? { trial: { runId } } : {}) },
    include: { trace: true, trial: true },
  });
  const created = [];
  for (const annotation of annotations) {
    const existing = await prisma.badcase.findUnique({ where: { traceRecordId: annotation.traceRecordId } });
    if (existing) continue;
    const badcase = await prisma.badcase.create({
      data: {
        traceRecordId: annotation.traceRecordId,
        trialId: annotation.trialId,
        caseId: annotation.trial?.caseId ?? annotation.trace.caseId,
        risk: annotation.trial?.risk,
        source: annotation.trace.source === "production" ? "production" : "eval-fail",
        dataSource: annotation.trace.source,
        status: "pending",
        triageResult: JSON.stringify({ reason: annotation.reason, issueType: annotation.issueType, scorerType: annotation.scorerType }),
      },
    });
    created.push(badcase);
  }
  return created;
}

export async function clusterBadcases(agentId: string) {
  const badcases = await prisma.badcase.findMany({
    where: { clusterId: null, status: "pending", trace: { agentId } },
    include: { trace: { include: { annotations: { where: { verdict: "fail" }, orderBy: { createdAt: "desc" }, take: 1 } } }, trial: true },
  });
  const groups = new Map<string, typeof badcases>();
  for (const badcase of badcases) {
    if (!badcase.trace) continue;
    const annotation = badcase.trace.annotations[0];
    const spans = JSON.parse(badcase.trace.spans) as Array<{ kind?: string; name?: string }>;
    const tool = spans.find((span) => span.kind === "tool")?.name ?? "none";
    const rootCause = annotation?.issueType ?? annotation?.problemCategory ?? "unknown";
    const key = `${rootCause}:${badcase.trial?.scenario ?? "unknown"}:${tool}`;
    groups.set(key, [...(groups.get(key) ?? []), badcase]);
  }
  const clusters = [];
  for (const [key, members] of groups) {
    const [rootCause, scenario, tool] = key.split(":");
    let cluster = await prisma.problemCluster.findFirst({ where: { agentId, rootCause, scenario, tool: tool === "none" ? null : tool, status: "open" } });
    if (!cluster) cluster = await prisma.problemCluster.create({ data: { agentId, rootCause, scenario, risk: members[0].risk, tool: tool === "none" ? null : tool, size: 0, status: "open", signature: key } });
    await prisma.badcase.updateMany({ where: { id: { in: members.map((member) => member.id) } }, data: { clusterId: cluster.id, status: "analyzed" } });
    const size = await prisma.badcase.count({ where: { clusterId: cluster.id, status: { not: "closed" } } });
    cluster = await prisma.problemCluster.update({ where: { id: cluster.id }, data: { size } });
    clusters.push({ clusterId: cluster.id, rootCause, scenario, tool, newMembers: members.length, totalSize: size });
  }
  return { clustered: badcases.length, clusters };
}

export async function createRcaRecord(input: RcaInput) {
  const badcase = await prisma.badcase.findUnique({ where: { id: input.badcaseId } });
  if (!badcase) throw new Error(`Badcase ${input.badcaseId} 不存在`);
  const record = await prisma.rcaRecord.upsert({
    where: { badcaseId: input.badcaseId },
    create: { badcaseId: input.badcaseId, candidateModules: JSON.stringify([input.responsibleModule]), moduleDiagnosis: JSON.stringify({ [input.responsibleModule]: "FAIL" }), responsibleModule: input.responsibleModule, problemCategory: input.problemCategory, problemEnum: input.problemEnum, confidence: input.confidence, evidence: input.evidence, report: input.report, owner: input.owner, fixActions: JSON.stringify(input.fixActions), specPath: input.specPath },
    update: { responsibleModule: input.responsibleModule, problemCategory: input.problemCategory, problemEnum: input.problemEnum, confidence: input.confidence, evidence: input.evidence, report: input.report, owner: input.owner, fixActions: JSON.stringify(input.fixActions), specPath: input.specPath },
  });
  await prisma.badcase.update({ where: { id: input.badcaseId }, data: { status: "needs-fix" } });
  return record;
}

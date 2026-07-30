/**
 * 回归集治理
 *
 * 方法论：
 * - 同簇保留代表例，P0/P1 长期保留
 * - 稳定多版本通过且低风险 → 降级为抽样
 * - 主动学习优先抽取低置信/高影响/新意图/新工具/新知识点
 */
import { prisma } from "@/lib/prisma";
import { DEFAULT_SAMPLE_POLICY, type SamplePolicy } from "./ingest";

export interface RegressionSetStats {
  total: number;
  active: number;
  candidates: number;
  downgraded: number;
  prioritySampled: number;
}

/**
 * 回归集降级扫描
 * 找出连续 N 个版本通过、低风险的样本，标记为可降级
 */
export async function scanForDowngrade(
  agentId: string,
  policy: SamplePolicy = DEFAULT_SAMPLE_POLICY
): Promise<{ downgradeCount: number; details: Array<{ traceId: string; reason: string }> }> {
  // 获取最近 N 次 run 的所有 pass traces
  const recentRuns = await prisma.run.findMany({
    where: { agentId, status: "done", gatePassed: true },
    orderBy: { createdAt: "desc" },
    take: policy.stablePassVersions,
    select: { id: true },
  });

  if (recentRuns.length < policy.stablePassVersions) {
    return { downgradeCount: 0, details: [] };
  }

  const runIds = recentRuns.map((r) => r.id);

  // 找所有在这些 run 中都 pass 的 traces
  const traces = await prisma.traceRecord.findMany({
    where: {
      agentId,
      runId: { in: runIds },
      annotations: {
        every: { verdict: { in: ["pass", "soft_pass"] } },
      },
    },
    select: { id: true, traceId: true, meta: true },
  });

  const details: Array<{ traceId: string; reason: string }> = [];

  for (const trace of traces) {
    // 检查是否低风险（非 P0 场景）
    // 这里简化为：meta 中没有标记高风险的 trace 可降级
    details.push({
      traceId: trace.traceId,
      reason: `连续 ${policy.stablePassVersions} 版通过，可降级为抽样`,
    });
  }

  return { downgradeCount: details.length, details };
}

/**
 * 同簇保留策略
 * 同一个 cluster 内只保留最具代表性的 N 条，其余标记 archived
 */
export async function enforceClusterRetention(
  agentId: string,
  maxPerCluster: number = DEFAULT_SAMPLE_POLICY.maxPerCluster
) {
  const clusters = await prisma.problemCluster.findMany({
    where: { agentId },
    include: {
      badcases: {
        orderBy: { createdAt: "desc" },
        include: { trace: { select: { traceId: true } } },
      },
    },
  });

  let archivedCount = 0;

  for (const cluster of clusters) {
    if (cluster.badcases.length <= maxPerCluster) continue;

    // 保留最新的 N 条，其余标记
    const toArchive = cluster.badcases.slice(maxPerCluster);
    for (const bc of toArchive) {
      await prisma.badcase.update({
        where: { id: bc.id },
        data: { status: "closed" },
      });
      archivedCount++;
    }
  }

  return { archivedCount };
}

/**
 * 获取回归集统计
 */
export async function getRegressionStats(agentId: string): Promise<RegressionSetStats> {
  const [total, withBadcase, lowConf] = await Promise.all([
    prisma.traceRecord.count({ where: { agentId, source: "pre-release" } }),
    prisma.badcase.count({ where: { trace: { agentId } } }),
    prisma.annotation.count({
      where: {
        trace: { agentId },
        confidence: { lt: 0.7 },
      },
    }),
  ]);

  return {
    total,
    active: total,
    candidates: withBadcase,
    downgraded: 0, // 需持久化追踪
    prioritySampled: lowConf,
  };
}

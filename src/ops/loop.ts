/**
 * Loop 周期化运营引擎
 *
 * 方法论 Loop：
 * 分层 → 分诊(triage) → 需求 Spec → 实现 → 重跑验证 → 修复结束 / 重跑
 *
 * 每个被测 Agent 的 loop 不同，由其开发者定义（存 loops/<agentId>.yaml）
 */
import { prisma } from "@/lib/prisma";
import { readYaml, fileExists, writeMarkdown } from "@/lib/fs-store";

// ── 类型 ──

export type LoopStage =
  | "identified"       // 已识别
  | "triaged"          // 已分诊
  | "spec-drafted"     // 需求 Spec 已写
  | "implementing"     // 实现中
  | "verifying"        // 重跑验证中
  | "verified"         // 验证通过
  | "closed"           // 关闭（无需处理）
  | "reopened";        // 验证未通过，重开

export interface LoopItem {
  id: string;
  clusterId: string;
  agentId: string;
  stage: LoopStage;
  triageResult: "needs-fix" | "observe" | "close";
  specPath?: string;
  verifyRunId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoopConfig {
  agentId: string;
  /** 自动分诊规则：cluster size >= threshold 自动判为 needs-fix */
  autoTriageThreshold: number;
  /** 验证时使用的 dataset */
  verifyDataset: string;
  /** 每轮最多处理多少个 cluster */
  batchSize: number;
}

// ── 分诊 ──

/**
 * 分诊：判定问题簇是否确需形成需求
 * - cluster size >= threshold → needs-fix
 * - 单条、低影响 → observe 或 close
 */
export async function triageClusters(agentId: string, config: LoopConfig) {
  const openClusters = await prisma.problemCluster.findMany({
    where: { agentId, status: "open" },
    orderBy: { size: "desc" },
    take: config.batchSize,
  });

  const results: Array<{
    clusterId: string;
    rootCause: string;
    size: number;
    decision: "needs-fix" | "observe" | "close";
    reason: string;
  }> = [];

  for (const cluster of openClusters) {
    let decision: "needs-fix" | "observe" | "close";
    let reason: string;

    if (cluster.size >= config.autoTriageThreshold) {
      decision = "needs-fix";
      reason = `问题簇规模 ${cluster.size} >= 阈值 ${config.autoTriageThreshold}，需修复`;
    } else if (cluster.size === 1) {
      decision = "observe";
      reason = "仅单条样本，继续观察";
    } else {
      decision = "observe";
      reason = `规模 ${cluster.size} 未达阈值，持续观察`;
    }

    // 更新 cluster status
    if (decision === "needs-fix") {
      await prisma.problemCluster.update({
        where: { id: cluster.id },
        data: { status: "fixing" },
      });
    }

    results.push({
      clusterId: cluster.id,
      rootCause: cluster.rootCause,
      size: cluster.size,
      decision,
      reason,
    });
  }

  return results;
}

// ── 需求 Spec 生成 ──

/**
 * 为需要修复的 cluster 生成需求 Spec 骨架
 */
export async function generateSpecDraft(
  clusterId: string,
  agentId: string
): Promise<string> {
  const cluster = await prisma.problemCluster.findUnique({
    where: { id: clusterId },
    include: {
      badcases: {
        take: 5,
        include: {
          trace: { select: { traceId: true, input: true } },
          rca: true,
        },
      },
    },
  });

  if (!cluster) throw new Error("Cluster 不存在");

  const specPath = `${agentId}/fix-${cluster.rootCause}-${Date.now()}.md`;
  const sampleInputs = cluster.badcases
    .map((bc) => {
      const input = JSON.parse(bc.trace.input) as { message: string };
      return `- ${input.message} (trace: ${bc.trace.traceId})`;
    })
    .join("\n");

  const rcaSummary = cluster.badcases
    .filter((bc) => bc.rca)
    .map((bc) => `- [${bc.rca!.problemEnum}] ${bc.rca!.responsibleModule}: ${bc.rca!.report ?? ""}`)
    .join("\n") || "- 暂无 RCA 记录";

  const content = `---
title: "修复：${cluster.rootCause}"
status: draft
cluster: ${clusterId}
agent: ${agentId}
priority: P1
---

# 需求 Spec：修复「${cluster.rootCause}」

## 问题概述

- **问题簇 ID**：${clusterId}
- **根因**：${cluster.rootCause}
- **涉及工具**：${cluster.tool ?? "多个"}
- **影响样本数**：${cluster.size}
- **集中版本**：${cluster.concentratedVersion ?? "未标记"}

## 典型失败样本

${sampleInputs}

## RCA 摘要

${rcaSummary}

## 修复方案

<!-- 开发者填写 -->

## 验收标准

- [ ] 上述典型样本全部通过规则 Scorer
- [ ] Golden 集回归无新增 fail
- [ ] 相关 cluster 可标记 verified

## 验证评测集

<!-- AI/人工编写相似评测集，至少 3 条 -->
`;

  await writeMarkdown("specs", specPath, content);
  return specPath;
}

// ── 重跑验证 ──

/**
 * 验证修复结果：对指定 cluster 关联的 traces 重跑评分
 * 返回是否全部通过
 */
export async function verifyFix(clusterId: string): Promise<{
  verified: boolean;
  passCount: number;
  failCount: number;
}> {
  const badcases = await prisma.badcase.findMany({
    where: { clusterId },
    include: {
      trace: {
        include: { annotations: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });

  let passCount = 0;
  let failCount = 0;

  for (const bc of badcases) {
    const lastAnn = bc.trace.annotations[0];
    if (lastAnn && (lastAnn.verdict === "pass" || lastAnn.verdict === "soft_pass")) {
      passCount++;
    } else {
      failCount++;
    }
  }

  const verified = failCount === 0 && passCount > 0;

  if (verified) {
    await prisma.problemCluster.update({
      where: { id: clusterId },
      data: { status: "verified" },
    });
  }

  return { verified, passCount, failCount };
}

// ── 加载 Loop 配置 ──

export async function loadLoopConfig(agentId: string): Promise<LoopConfig> {
  const loopFile = `${agentId}.yaml`;
  const exists = await fileExists("loops", loopFile);

  if (exists) {
    return readYaml<LoopConfig>("loops", loopFile);
  }

  // 默认配置
  return {
    agentId,
    autoTriageThreshold: 3,
    verifyDataset: `${agentId}/golden.yaml`,
    batchSize: 10,
  };
}

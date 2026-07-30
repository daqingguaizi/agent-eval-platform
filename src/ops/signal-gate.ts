/**
 * 离线门禁与线上灰度三类信号联动
 *
 * 方法论三类信号：
 * 1. 离线质量：核心场景通过率 / P0 风险数 / 关键工具参数正确率
 * 2. 线上体验：转人工率 / 重复追问率 / 投诉率 / 满意度
 * 3. 业务结果：任务完成率 / 工单闭环率 / 退款赔付成功率
 *
 * 联动规则：离线升但线上关键信号恶化 → 触发回滚或降级
 */

export interface OfflineSignal {
  corePassRate: number;      // 核心场景通过率 (0-1)
  p0RiskCount: number;       // P0 风险数
  toolParamAccuracy: number; // 关键工具参数正确率 (0-1)
}

export interface OnlineSignal {
  humanTransferRate: number;  // 转人工率
  repeatAskRate: number;      // 重复追问率
  complaintRate: number;      // 投诉率
  satisfaction: number;       // 满意度 (0-5)
}

export interface BusinessSignal {
  taskCompletionRate: number;  // 任务完成率
  ticketCloseRate: number;     // 工单闭环率
  refundSuccessRate: number;   // 退款赔付成功率
}

export interface SignalThresholds {
  offline: {
    minCorePassRate: number;
    maxP0Risk: number;
    minToolParamAccuracy: number;
  };
  online: {
    maxHumanTransferRate: number;
    maxRepeatAskRate: number;
    maxComplaintRate: number;
    minSatisfaction: number;
  };
  business: {
    minTaskCompletion: number;
  };
}

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  offline: {
    minCorePassRate: 0.95,
    maxP0Risk: 0,
    minToolParamAccuracy: 0.9,
  },
  online: {
    maxHumanTransferRate: 0.15,
    maxRepeatAskRate: 0.2,
    maxComplaintRate: 0.02,
    minSatisfaction: 3.5,
  },
  business: {
    minTaskCompletion: 0.85,
  },
};

export type GateDecision = "pass" | "warn" | "rollback";

export interface GateResult {
  decision: GateDecision;
  violations: string[];
  signals: {
    offline: OfflineSignal;
    online?: OnlineSignal;
    business?: BusinessSignal;
  };
}

/**
 * 联合门禁判定
 */
export function evaluateGate(
  offline: OfflineSignal,
  online?: OnlineSignal,
  business?: BusinessSignal,
  thresholds: SignalThresholds = DEFAULT_THRESHOLDS
): GateResult {
  const violations: string[] = [];

  // 离线信号
  if (offline.corePassRate < thresholds.offline.minCorePassRate) {
    violations.push(
      `离线核心通过率 ${(offline.corePassRate * 100).toFixed(1)}% < ${thresholds.offline.minCorePassRate * 100}%`
    );
  }
  if (offline.p0RiskCount > thresholds.offline.maxP0Risk) {
    violations.push(`P0 风险数 ${offline.p0RiskCount} > ${thresholds.offline.maxP0Risk}`);
  }
  if (offline.toolParamAccuracy < thresholds.offline.minToolParamAccuracy) {
    violations.push(`工具参数正确率 ${(offline.toolParamAccuracy * 100).toFixed(1)}% < ${thresholds.offline.minToolParamAccuracy * 100}%`);
  }

  // 线上信号（离线升但线上恶化 → 回滚）
  if (online) {
    if (online.humanTransferRate > thresholds.online.maxHumanTransferRate) {
      violations.push(`转人工率 ${(online.humanTransferRate * 100).toFixed(1)}% 超标`);
    }
    if (online.complaintRate > thresholds.online.maxComplaintRate) {
      violations.push(`投诉率 ${(online.complaintRate * 100).toFixed(1)}% 超标`);
    }
    if (online.satisfaction < thresholds.online.minSatisfaction) {
      violations.push(`满意度 ${online.satisfaction} < ${thresholds.online.minSatisfaction}`);
    }
  }

  // 业务信号
  if (business) {
    if (business.taskCompletionRate < thresholds.business.minTaskCompletion) {
      violations.push(`任务完成率 ${(business.taskCompletionRate * 100).toFixed(1)}% < ${thresholds.business.minTaskCompletion * 100}%`);
    }
  }

  // 决策
  let decision: GateDecision;
  const hasOnlineViolation = online && violations.some((v) => v.includes("转人工") || v.includes("投诉") || v.includes("满意度"));

  if (violations.length === 0) {
    decision = "pass";
  } else if (hasOnlineViolation || offline.p0RiskCount > 0) {
    decision = "rollback"; // 线上恶化或 P0 风险 → 回滚
  } else {
    decision = "warn";
  }

  return {
    decision,
    violations,
    signals: { offline, online, business },
  };
}

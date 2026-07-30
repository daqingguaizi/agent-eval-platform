/**
 * 上线后 session/trace 采集与回流
 *
 * 方法论 - 反馈入库 5 条标准：
 * 1. 失败可复现或有稳定 Trace + 人工确认
 * 2. 期望行为明确（可写成规则/Judge 标准/人工验收）
 * 3. 根因标签清楚
 * 4. 样本有代表性
 * 5. 已脱敏合规
 */

export interface IngestValidation {
  reproducible: boolean;    // 标准1: 可复现
  expectationClear: boolean; // 标准2: 期望明确
  rootCauseClear: boolean;   // 标准3: 根因清楚
  representative: boolean;   // 标准4: 有代表性
  sanitized: boolean;        // 标准5: 已脱敏
}

export interface IngestResult {
  accepted: boolean;
  violations: string[];
  traceId?: string;
}

/**
 * 校验入库 5 条标准
 */
export function validateIngestStandards(v: IngestValidation): {
  passed: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  if (!v.reproducible) violations.push("不满足标准1：失败不可复现");
  if (!v.expectationClear) violations.push("不满足标准2：期望行为不明确");
  if (!v.rootCauseClear) violations.push("不满足标准3：根因标签不清楚");
  if (!v.representative) violations.push("不满足标准4：样本不具代表性");
  if (!v.sanitized) violations.push("不满足标准5：未脱敏合规");
  return { passed: violations.length === 0, violations };
}

/**
 * 样本治理 - 降级策略
 *
 * 方法论：
 * - 同簇保留代表例
 * - P0/P1 长期保留
 * - 稳定多版本通过且低风险：降级为抽样
 * - 主动学习优先抽取：低置信/高影响/新意图/新工具/新知识点
 */
export type SampleStatus = "active" | "sampled" | "archived";

export interface SamplePolicy {
  /** 连续通过版本数达此阈值可降级 */
  stablePassVersions: number;
  /** 低风险判定（非 P0） */
  lowRiskPriorities: string[];
  /** 同簇最大保留数 */
  maxPerCluster: number;
}

export const DEFAULT_SAMPLE_POLICY: SamplePolicy = {
  stablePassVersions: 3,
  lowRiskPriorities: ["P2"],
  maxPerCluster: 5,
};

/**
 * 主动学习优先抽取条件
 */
export interface ActiveLearningSignal {
  lowConfidence: boolean;   // 置信度 < 0.7
  highImpact: boolean;      // P0 场景
  newIntent: boolean;       // 新意图/新用户表达
  newTool: boolean;         // 新工具上线
  newKnowledge: boolean;    // 新知识点/规则变更
}

export function shouldPrioritySample(signal: ActiveLearningSignal): boolean {
  return Object.values(signal).some(Boolean);
}

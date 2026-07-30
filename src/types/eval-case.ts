export const EVAL_CASE_SCENARIOS = ["trigger", "core_logic", "output_quality", "exception"] as const;
export const EVAL_CASE_RISKS = ["P0", "P1", "P2"] as const;
export const EVAL_CASE_SOURCES = ["expert", "expanded", "production", "badcase"] as const;
export const EVAL_CASE_STATUSES = ["draft", "review", "active", "deprecated"] as const;
export const DATASET_SPLITS = ["train", "validation", "test", "regression", "calibration", "capability"] as const;

export type EvalCaseScenario = (typeof EVAL_CASE_SCENARIOS)[number];
export type EvalCaseRisk = (typeof EVAL_CASE_RISKS)[number];
export type EvalCaseSource = (typeof EVAL_CASE_SOURCES)[number];
export type EvalCaseStatus = (typeof EVAL_CASE_STATUSES)[number];
export type DatasetSplit = (typeof DATASET_SPLITS)[number];

export interface EvalCase {
  id: string;
  title: string;
  description?: string;
  agent: string;
  skill?: string;
  category: string;
  scenario: EvalCaseScenario;
  risk: EvalCaseRisk;
  tags?: string[];
  source: EvalCaseSource;
  status: EvalCaseStatus;
  dataset_split?: DatasetSplit;
  precondition?: Record<string, unknown>;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  judge: EvalCaseJudge;
  ground_truth_version?: string;
}

export interface EvalCaseJudge {
  strategy: "rule" | "llm" | "hybrid" | "human";
  rules?: Array<{ type: string; [key: string]: unknown }>;
  llmJudge?: {
    enabled: boolean;
    criteria?: Array<Record<string, unknown>>;
    fewShots?: Array<Record<string, unknown>>;
  };
  consistency?: { repeat: number; requireConsecutive?: boolean };
}

export interface EvalCaseValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateEvalCase(value: unknown): EvalCaseValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, issues: ["用例必须是对象"] };
  }
  const item = value as Partial<EvalCase>;
  const issues: string[] = [];
  if (!item.id) issues.push("缺少 id");
  if (!item.title) issues.push("缺少 title");
  if (!item.agent) issues.push("缺少 agent");
  if (!item.category) issues.push("缺少 category");
  if (!EVAL_CASE_SCENARIOS.includes(item.scenario as EvalCaseScenario)) issues.push("scenario 无效");
  if (!EVAL_CASE_RISKS.includes(item.risk as EvalCaseRisk)) issues.push("risk 无效");
  if (!EVAL_CASE_SOURCES.includes(item.source as EvalCaseSource)) issues.push("source 无效");
  if (!EVAL_CASE_STATUSES.includes(item.status as EvalCaseStatus)) issues.push("status 无效");
  if (item.dataset_split && !DATASET_SPLITS.includes(item.dataset_split)) issues.push("dataset_split 无效");
  if (!item.input || typeof item.input !== "object") issues.push("缺少 input");
  if (!item.expected || typeof item.expected !== "object") issues.push("缺少 expected");
  if (!item.judge || typeof item.judge !== "object") issues.push("缺少 judge");
  if (item.judge && !["rule", "llm", "hybrid", "human"].includes(item.judge.strategy)) issues.push("judge.strategy 无效");
  const repeat = item.judge?.consistency?.repeat;
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)) issues.push("judge.consistency.repeat 必须为 1 到 20 的整数");
  return { valid: issues.length === 0, issues };
}

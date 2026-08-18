export const PILOT_SCORE_SCHEMA_VERSION = 1;
export const PILOT_SCORE_SPEC_VERSION = "1.5.0";

export const SCORE_DIMENSIONS = [
    "executionEvidence",
    "taskOrchestration",
    "canvasUsability",
    "artifactQuality",
    "reliabilityBoundary",
] as const;
export type ScoreDimension = typeof SCORE_DIMENSIONS[number];
export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
    executionEvidence: 20,
    taskOrchestration: 20,
    canvasUsability: 15,
    artifactQuality: 30,
    reliabilityBoundary: 15,
};

export const FINAL_STATUSES = ["pending_human_review", "pass", "pass_with_improvements", "partial", "fail", "not_evaluable"] as const;
export type FinalStatus = typeof FINAL_STATUSES[number];
export const RULE_STATUSES = ["pass", "fail", "not_applicable", "needs_human_review"] as const;
export type RuleStatus = typeof RULE_STATUSES[number];
export const ATTRIBUTION_STAGES = ["case_definition", "agent_planning", "tool_selection", "parameterization", "generation_execution", "canvas_write", "media_storage", "workspace_sync", "evidence_archive", "viewer", "evaluation_design"] as const;
export const ATTRIBUTION_SYMPTOMS = ["not_triggered", "wrong_modality", "duplicate_generation", "wrong_connection", "timeout", "state_mismatch", "media_missing", "constraint_violation", "quality_insufficient", "misleading_feedback", "not_reproducible"] as const;
export const RESPONSIBLE_AREAS = ["case_spec", "runner", "canvas_agent", "canvas_frontend", "workspace_sync", "model_or_provider", "media_service", "scorer", "viewer"] as const;
export const ISSUE_NATURES = ["functional_failure", "reliability", "quality_debt", "ux", "safety_boundary", "evaluation_gap", "external_dependency"] as const;
export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;

export type EvidencePointer = { path: string; label: string; pointer?: string };
export type DeterministicRule = {
    id: string;
    status: RuleStatus;
    hardGate?: boolean;
    score: number | null;
    reason: string;
    evidence: EvidencePointer[];
    remediation?: string;
};
export type DeterministicCaseScore = {
    caseId: string;
    status: FinalStatus;
    hardGateFailed: boolean;
    dimensionScores: Partial<Record<ScoreDimension, number>>;
    rules: DeterministicRule[];
};

export type Attribution = {
    id: string;
    stage: typeof ATTRIBUTION_STAGES[number];
    symptom: typeof ATTRIBUTION_SYMPTOMS[number];
    responsibleArea: typeof RESPONSIBLE_AREAS[number];
    nature: typeof ISSUE_NATURES[number];
    severity: typeof SEVERITIES[number];
    confidence: number;
    evidence: EvidencePointer[];
    impact: string;
    recommendation: string;
    ownerModule: string;
};

export type HumanReview = {
    id: string;
    reviewerId: string;
    createdAt: string;
    isCurrent: boolean;
    status: FinalStatus;
    scores: Partial<Record<ScoreDimension, number | null>>;
    evidence: EvidencePointer[];
    attributions: Attribution[];
    notes: string;
    recommendation: string;
    needsConfirmation?: boolean;
};

export type JudgeTask = {
    schemaVersion: number;
    specVersion: string;
    taskId: string;
    caseId: string;
    modelId: "deepseek-v4-pro";
    status: "pending" | "not_applicable";
    instruction: string;
    deterministicSummary: DeterministicCaseScore;
    evidence: EvidencePointer[];
    media: Array<{ role: "input" | "output"; mediaType: string; path: string; keyframes?: Array<{ timeMs: number; path: string }> }>;
    rubric: Array<{ dimension: ScoreDimension; prompt: string }>;
    responseContract: Record<string, unknown>;
};

export type JudgeResult = {
    taskId: string;
    caseId: string;
    modelId: "deepseek-v4-pro";
    status: "complete" | "not_run" | "not_applicable" | "error";
    createdAt: string;
    scores?: Partial<Record<ScoreDimension, number | null>>;
    confidence?: number;
    evidence?: EvidencePointer[];
    findings?: string[];
    humanFocus?: string[];
    raw?: unknown;
};

export type PilotScoreSummary = {
    schemaVersion: number;
    specVersion: string;
    runId: string;
    generatedAt: string;
    totalCases: number;
    humanComplete: number;
    reportReady: boolean;
    missing: string[];
    finalStatusCounts: Record<string, number>;
    dimensionAverages: Partial<Record<ScoreDimension, number>>;
    clusters: Array<{ key: string; caseIds: string[]; highestSeverity: string; recommendation: string }>;
};

export function isFinalStatus(value: unknown): value is FinalStatus { return typeof value === "string" && (FINAL_STATUSES as readonly string[]).includes(value); }
export function isScore(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5; }
export function validateHumanReview(input: unknown): asserts input is HumanReview {
    const value = input as Partial<HumanReview>;
    if (!value || typeof value !== "object" || typeof value.reviewerId !== "string" || !value.reviewerId.trim()) throw new Error("评审人不能为空");
    if (!isFinalStatus(value.status)) throw new Error("评分结论无效");
    if (!value.scores || typeof value.scores !== "object") throw new Error("必须提交维度评分");
    if (!value.notes?.trim()) throw new Error("必须填写评审说明");
    for (const [dimension, score] of Object.entries(value.scores)) if (!(SCORE_DIMENSIONS as readonly string[]).includes(dimension) || (score !== null && !isScore(score))) throw new Error(`维度评分无效：${dimension}`);
}

export function weightedScore(scores: Partial<Record<ScoreDimension, number | null>>) {
    let weight = 0; let total = 0;
    for (const dimension of SCORE_DIMENSIONS) { const value = scores[dimension]; if (typeof value === "number") { total += value / 5 * SCORE_WEIGHTS[dimension]; weight += SCORE_WEIGHTS[dimension]; } }
    return weight ? Math.round(total / weight * 100) : null;
}

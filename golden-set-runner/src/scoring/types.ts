import type { GoldenCase, CaseTrace } from "../types";

export type Verdict = "pass" | "fail" | "needs_human_review" | "not_applicable" | "evidence_invalid";
export type ReviewStatus = "unassigned" | "draft" | "submitted" | "second_review_required" | "second_submitted" | "adjudicated";
export type RuleStatus = Verdict;

export type EvidenceRef = {
    file: string;
    pointer: string;
    excerpt?: string;
    sourceFile?: string;
    sourcePointer?: string;
};

/** 仅用于 Review UI/API；持久化时始终还原为 EvidenceRef。 */
export type ReviewEvidenceCard = {
    id: string;
    title: string;
    category: string;
    detail: string;
    ref: EvidenceRef;
    recommended: boolean;
};

export type ReviewEvidenceCatalog = {
    cards: ReviewEvidenceCard[];
    selectedByDefault: string[];
};

export type ReviewSubmission = Partial<HumanReview> & {
    evidenceCardIds?: string[];
};

export type AssertionBinding = {
    ruleId: string;
    hardGate?: boolean;
    config?: Record<string, unknown>;
    source?: string;
};

export type CaseAssertionSidecar = {
    schemaVersion: 1;
    caseId: string;
    targetTurn: number;
    requiredSteps: string[];
    criteriaAliases: string[];
    behaviorCategory: string;
    risk: string;
    ruleBindings: AssertionBinding[];
    rubricIds: JudgeDimension[];
    humanFocus: string[];
    budgetPolicy: Record<string, "gate" | "warning" | "observe_only">;
    sourceNotes: string[];
};

export type AssertionResult = {
    ruleId: string;
    status: RuleStatus;
    hardGate: boolean;
    expected: unknown;
    actual: unknown;
    evidenceRefs: EvidenceRef[];
    issueType?: string;
    reason: string;
    scorerVersion: string;
    standardVersion: string;
};

export type LayerVerdict = {
    verdict: Verdict;
    score?: number;
    confidence?: number;
    reason: string;
    standardVersion: string;
    standardSha256: string;
};

export type JudgeDimension = "RUBRIC_EVIDENCE_FAITHFULNESS" | "RUBRIC_TASK_RESOLUTION" | "RUBRIC_CLARITY_ACTIONABILITY" | "RUBRIC_CREATIVE_ALIGNMENT";

export type JudgeAssessment = LayerVerdict & {
    status: "not_run" | "complete" | "error";
    rubricIds: JudgeDimension[];
    dimensionScores?: Partial<Record<JudgeDimension, number>>;
    issueType?: string;
    evidence?: EvidenceRef[];
    evidenceHash?: string;
    rubricHash?: string;
    model?: string;
    promptHash?: string;
    latencyMs?: number;
    cacheHit?: boolean;
    raw?: unknown;
    error?: string;
    needsHumanReview?: boolean;
};

export type HumanReview = LayerVerdict & {
    reviewId: string;
    reviewerId: string;
    role: "reviewer_a" | "reviewer_b" | "adjudicator";
    status: ReviewStatus;
    createdAt: string;
    updatedAt: string;
    rubricScores: Partial<Record<JudgeDimension, number>>;
    hardGateConfirmed: boolean;
    evidenceRefs: EvidenceRef[];
    issueTypes: string[];
    responsibleModules: string[];
    notes: string;
    evidenceCompleteness: "complete" | "partial" | "invalid";
    recommendations: { badcase: boolean; regression: boolean; calibration: boolean };
    supersedes?: string;
};

export type Badcase = {
    caseId: string;
    attempt: number;
    issueTypes: string[];
    evidenceRefs: EvidenceRef[];
    owner?: string;
    status: "candidate" | "confirmed" | "fixed" | "rejected";
    regressionCandidate: boolean;
    action?: string;
};

export type CaseAssessment = {
    schemaVersion: 1;
    assessmentId: string;
    traceRef: { runId: string; caseId: string; attempt: number; traceFile: string; traceSha256: string };
    caseRef: { caseFile: string; caseSha256: string; sidecarFile: string; sidecarSha256: string };
    contractRef: { file: string; sha256: string };
    standard: { version: string; sha256: string };
    provenance: "complete" | "partial";
    createdAt: string;
    deterministic: { assertions: AssertionResult[]; verdict: LayerVerdict; diagnosticDimensions: { result: number; process: number; safety: number; output: number } };
    judge: JudgeAssessment;
    human: HumanReview[];
    final: LayerVerdict & { adjudicated: boolean; diagnosticScore?: number };
    badcase?: Badcase;
};

export type ScoreIndexEntry = {
    caseId: string;
    attempt: number;
    title: string;
    scenario: GoldenCase["scenario"];
    risk: GoldenCase["risk"];
    sampleType: GoldenCase["sampleType"];
    canvasType: GoldenCase["canvasType"];
    traceFile: string;
    deterministicVerdict: Verdict;
    judgeVerdict: string;
    humanStatus: ReviewStatus;
    finalVerdict: string;
    hardGateFailures: number;
    needsHumanReview: boolean;
    issueTypes: string[];
    diagnosticScore?: number;
};

export type LoadedCase = { caseDef: GoldenCase; trace: CaseTrace; sidecar: CaseAssertionSidecar; traceFile: string; caseFile: string; sidecarFile: string };

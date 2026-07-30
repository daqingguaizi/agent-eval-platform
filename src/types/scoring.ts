export type ScorerVerdict = "pass" | "soft_pass" | "fail" | "no_trace" | "skipped";

export interface TrialUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  toolCalls?: number;
  latencyMs?: number;
  costCny?: number;
}

export interface CaseResult {
  caseId: string;
  risk: string;
  category: string;
  scenario: string;
  verdict: ScorerVerdict;
  ruleVerdict?: ScorerVerdict;
  llmVerdict?: ScorerVerdict;
  humanVerdict?: ScorerVerdict;
  reason: string;
  traceId?: string;
  usage?: TrialUsage;
  consistency?: { runs: number; passes: number; passRate: number; passAtK: boolean; passToK: boolean };
}

export interface GateDimension {
  pass: number;
  fail: number;
  total: number;
  passRate: number;
}

export interface GateResult {
  passed: boolean;
  p0: { violations: number; passed: boolean };
  p1: { passRate: number; threshold: number; wilsonLower: number; passed: boolean };
  p2: { total: number; failed: number };
  byPriority: Record<string, GateDimension>;
  byDimension: Record<string, GateDimension>;
  reasons: string[];
}

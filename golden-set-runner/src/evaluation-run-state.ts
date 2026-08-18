import fs from "node:fs/promises";
import path from "node:path";

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "paused_for_human" | "blocked";
export type AcceptanceStatus = "pending" | "passed" | "failed" | "needs_review" | "limited";
export type EvidenceStatus = "pending" | "complete" | "partial" | "missing";
export type InterventionStatus = "none" | "auto_confirmed" | "waiting_for_human" | "human_confirmed" | "resume_requested";

export type EvaluationCaseState = {
  caseId: string;
  canvasId?: string;
  canvasType: "content" | "story";
  executionStatus: ExecutionStatus;
  acceptanceStatus: AcceptanceStatus;
  evidenceStatus: EvidenceStatus;
  interventionStatus: InterventionStatus;
  createdAt: string;
  updatedAt: string;
  resumeCount: number;
  workspaceRevision?: number;
  modelRouting?: Record<string, string>;
  taskIds: string[];
  events: Array<{ at: string; type: string; detail?: string }>;
};

export type EvaluationRunState = {
  schemaVersion: 1;
  runId: string;
  account: string;
  profileDirectory: string;
  createdAt: string;
  updatedAt: string;
  cases: Record<string, EvaluationCaseState>;
};

export async function readRunState(runDir: string): Promise<EvaluationRunState | null> {
  return fs.readFile(path.join(runDir, "evaluation-state.json"), "utf8").then((value) => JSON.parse(value) as EvaluationRunState).catch(() => null);
}

export async function writeRunState(runDir: string, state: EvaluationRunState) {
  state.updatedAt = new Date().toISOString();
  const target = path.join(runDir, "evaluation-state.json");
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(temporary, target);
}

export function createRunState(runId: string, account: string, profileDirectory: string): EvaluationRunState {
  const now = new Date().toISOString();
  return { schemaVersion: 1, runId, account, profileDirectory, createdAt: now, updatedAt: now, cases: {} };
}

export function initializeCaseState(state: EvaluationRunState, caseId: string, canvasType: "content" | "story") {
  const existing = state.cases[caseId];
  if (existing) return existing;
  const now = new Date().toISOString();
  const next: EvaluationCaseState = {
    caseId,
    canvasType,
    executionStatus: "pending",
    acceptanceStatus: "pending",
    evidenceStatus: "pending",
    interventionStatus: "none",
    createdAt: now,
    updatedAt: now,
    resumeCount: 0,
    taskIds: [],
    events: [],
  };
  state.cases[caseId] = next;
  return next;
}

export function updateCaseState(state: EvaluationRunState, caseId: string, patch: Partial<EvaluationCaseState>, event?: { type: string; detail?: string }) {
  const current = state.cases[caseId];
  if (!current) throw new Error(`未初始化的评测 Case 状态：${caseId}`);
  Object.assign(current, patch, { updatedAt: new Date().toISOString() });
  if (event) current.events.push({ at: current.updatedAt, ...event });
  return current;
}

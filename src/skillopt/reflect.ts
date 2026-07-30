import type { BoundedEdit } from "./bounded-edit";

export function reflectEvidence(evidence: { caseResults: Array<{ caseId?: string; verdict?: string; reason?: string }> }) {
  const failures = evidence.caseResults.filter((item) => item.verdict === "fail" || item.verdict === "no_trace");
  return { failures: failures.map((item) => ({ caseId: item.caseId, reason: item.reason })), suggestedEdits: [] as BoundedEdit[], note: "候选编辑必须由人工或优化器基于多个失败模式填充，禁止为单条 Case 硬编码。" };
}

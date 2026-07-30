import type { CaseResult, GateDimension, GateResult, ScorerVerdict } from "@/types";

function scored(verdict: ScorerVerdict) {
  return verdict === "pass" || verdict === "soft_pass" || verdict === "fail" || verdict === "no_trace";
}

function passed(result: CaseResult) {
  return result.verdict === "pass" || (result.risk !== "P0" && result.verdict === "soft_pass");
}

export function wilsonLowerBound(pass: number, total: number, z = 1.96) {
  if (!total) return 0;
  const rate = pass / total;
  const zSquared = z * z;
  return Math.max(0, (rate + zSquared / (2 * total) - z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * total)) / total)) / (1 + zSquared / total));
}

function bucket(): GateDimension {
  return { pass: 0, fail: 0, total: 0, passRate: 0 };
}

export function evaluateGate(results: CaseResult[], p1Threshold = 0.95): GateResult {
  const byPriority: Record<string, GateDimension> = {};
  const byDimension: Record<string, GateDimension> = {};
  const reasons: string[] = [];
  for (const result of results) {
    if (!scored(result.verdict)) continue;
    const priority = result.risk || "P2";
    const dimension = result.category || "uncategorized";
    byPriority[priority] ??= bucket();
    byDimension[dimension] ??= bucket();
    for (const target of [byPriority[priority], byDimension[dimension]]) {
      target.total += 1;
      if (passed(result)) target.pass += 1;
      else target.fail += 1;
    }
  }
  for (const entry of [...Object.values(byPriority), ...Object.values(byDimension)]) entry.passRate = entry.total ? entry.pass / entry.total : 0;
  const p0 = byPriority.P0 ?? bucket();
  const p1 = byPriority.P1 ?? bucket();
  const p0Passed = p0.fail === 0;
  const p1Wilson = wilsonLowerBound(p1.pass, p1.total);
  const p1Passed = p1.total === 0 || p1Wilson >= p1Threshold;
  const p2 = byPriority.P2 ?? bucket();
  if (!p0Passed) reasons.push(`P0 一票否决：${p0.fail} 条高风险用例未通过`);
  if (!p1Passed) reasons.push(`P1 Wilson 下界 ${(p1Wilson * 100).toFixed(1)}% 未达到 ${(p1Threshold * 100).toFixed(0)}%`);
  return {
    passed: p0Passed && p1Passed,
    p0: { violations: p0.fail, passed: p0Passed },
    p1: { passRate: p1.passRate, threshold: p1Threshold, wilsonLower: p1Wilson, passed: p1Passed },
    p2: { total: p2.total, failed: p2.fail },
    byPriority,
    byDimension,
    reasons: reasons.length ? reasons : ["P0/P1 门禁通过"],
  };
}

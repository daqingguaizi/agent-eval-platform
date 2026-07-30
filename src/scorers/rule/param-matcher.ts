export type MatchRule =
  | { $eq: unknown }
  | { $regex: string }
  | { $contains: unknown }
  | { $type: string }
  | { $oneOf: unknown[] }
  | { $gte: number }
  | { $lte: number }
  | { $exists: boolean };

export function matchValue(actual: unknown, rule: MatchRule | unknown): boolean {
  if (rule === null || rule === undefined) return true;
  if (typeof rule !== "object" || Array.isArray(rule)) return actual === rule;
  const ruleObj = rule as Record<string, unknown>;
  const keys = Object.keys(ruleObj);
  if (!keys.some((key) => key.startsWith("$"))) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    return keys.every((key) => matchValue((actual as Record<string, unknown>)[key], ruleObj[key]));
  }
  if ("$exists" in ruleObj) return Boolean(ruleObj.$exists) === (actual !== undefined && actual !== null);
  if ("$eq" in ruleObj) return JSON.stringify(actual) === JSON.stringify(ruleObj.$eq);
  if ("$regex" in ruleObj) return new RegExp(String(ruleObj.$regex)).test(String(actual ?? ""));
  if ("$contains" in ruleObj) return Array.isArray(actual) ? actual.some((item) => JSON.stringify(item) === JSON.stringify(ruleObj.$contains)) : String(actual ?? "").includes(String(ruleObj.$contains));
  if ("$type" in ruleObj) return typeof actual === ruleObj.$type;
  if ("$oneOf" in ruleObj) return (ruleObj.$oneOf as unknown[]).some((value) => JSON.stringify(value) === JSON.stringify(actual));
  if ("$gte" in ruleObj) return typeof actual === "number" && actual >= Number(ruleObj.$gte);
  if ("$lte" in ruleObj) return typeof actual === "number" && actual <= Number(ruleObj.$lte);
  return false;
}

export function matchObject(actual: Record<string, unknown>, expected: Record<string, unknown>): { pass: boolean; failures: string[] } {
  const failures = Object.entries(expected)
    .filter(([key, rule]) => !matchValue(actual[key], rule))
    .map(([key, rule]) => `字段 "${key}": 期望 ${JSON.stringify(rule)}，实际 ${JSON.stringify(actual[key])}`);
  return { pass: failures.length === 0, failures };
}

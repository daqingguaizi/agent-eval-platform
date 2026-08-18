import fs from "node:fs/promises";
import path from "node:path";

const sourceRun = process.env.ECHO_MERGE_SOURCE_RUN || "";
const rerun = process.env.ECHO_MERGE_RERUN || "";
const rawCaseIds = process.env.ECHO_CASE_IDS || "";

async function main() {
  if (!sourceRun || !rerun || !rawCaseIds) throw new Error("需要 ECHO_MERGE_SOURCE_RUN、ECHO_MERGE_RERUN 与 ECHO_CASE_IDS");
  const sourceDir = path.resolve(sourceRun);
  const rerunDir = path.resolve(rerun);
  const caseIds = rawCaseIds.split(",").map((id) => id.trim()).filter(Boolean);
  const scoringDir = path.join(sourceDir, "scoring");
  const [sourceRunJson, sourceStateJson, rerunRunJson, rerunStateJson] = await Promise.all([
    fs.readFile(path.join(sourceDir, "run.json"), "utf8").then((text) => JSON.parse(text)),
    fs.readFile(path.join(sourceDir, "evaluation-state.json"), "utf8").then((text) => JSON.parse(text)),
    fs.readFile(path.join(rerunDir, "run.json"), "utf8").then((text) => JSON.parse(text)),
    fs.readFile(path.join(rerunDir, "evaluation-state.json"), "utf8").then((text) => JSON.parse(text)),
  ]);
  for (const caseId of caseIds) {
    if (!rerunRunJson.results.some((item: { id: string }) => item.id === caseId) || !rerunStateJson.cases[caseId]) throw new Error(`重跑结果缺少 ${caseId}`);
    const sourceCase = path.join(sourceDir, caseId);
    const rerunCase = path.join(rerunDir, caseId);
    await fs.rm(sourceCase, { recursive: true, force: true });
    await fs.cp(rerunCase, sourceCase, { recursive: true, errorOnExist: true });
    sourceRunJson.results[sourceRunJson.results.findIndex((item: { id: string }) => item.id === caseId)] = rerunRunJson.results.find((item: { id: string }) => item.id === caseId);
    sourceStateJson.cases[caseId] = rerunStateJson.cases[caseId];
  }
  // 原始 Run 可被新证据覆盖，但评分层必须保留审计而不能继续把旧评审当成当前结论。
  const invalidationFile = path.join(scoringDir, "invalidations.json");
  const invalidations = await fs.readFile(invalidationFile, "utf8").then((text) => JSON.parse(text)).catch(() => ({ schemaVersion: 1, updatedAt: "", cases: {} }));
  const invalidatedAt = new Date().toISOString();
  for (const caseId of caseIds) invalidations.cases[caseId] = { invalidatedAt, reason: "局部重跑已替换原始运行证据，需重新确认评分", rerun: rerunDir };
  invalidations.updatedAt = invalidatedAt;
  await fs.mkdir(scoringDir, { recursive: true });
  await fs.writeFile(invalidationFile, `${JSON.stringify(invalidations, null, 2)}\n`);
  // 自动评分和模型任务均依赖运行证据，任意 Case 被覆盖后统一作废，避免混合旧新版本。
  await Promise.all(["deterministic.json", "judge-task-index.json", "judge-results.json", "summary.json", "development-report.md"].map((name) => fs.rm(path.join(scoringDir, name), { force: true })));
  sourceStateJson.updatedAt = invalidatedAt;
  const temporaryRun = `${path.join(sourceDir, "run.json")}.tmp`;
  const temporaryState = `${path.join(sourceDir, "evaluation-state.json")}.tmp`;
  await Promise.all([
    fs.writeFile(temporaryRun, `${JSON.stringify(sourceRunJson, null, 2)}\n`),
    fs.writeFile(temporaryState, `${JSON.stringify(sourceStateJson, null, 2)}\n`),
  ]);
  await Promise.all([fs.rename(temporaryRun, path.join(sourceDir, "run.json")), fs.rename(temporaryState, path.join(sourceDir, "evaluation-state.json"))]);
  await fs.writeFile(path.join(sourceDir, "rerun-merge-last.json"), `${JSON.stringify({ mergedAt: new Date().toISOString(), sourceRun: sourceDir, rerun: rerunDir, caseIds }, null, 2)}\n`);
  console.log(JSON.stringify({ merged: caseIds, sourceRun: sourceDir, rerun: rerunDir }));
}

void main();

import fs from "node:fs/promises";
import path from "node:path";
import { archiveCanvasSnapshot } from "./evaluation-artifact-store";
import { loadEvaluationEnvironment } from "./evaluation-env";
import { readRunState, updateCaseState, writeRunState } from "./evaluation-run-state";

loadEvaluationEnvironment();

const BASE_URL = process.env.ECHO_WEB_BASE_URL || "http://127.0.0.1:3000";
const runDir = process.env.ECHO_ANNOTATE_RUN_DIR || "";
const caseId = process.env.ECHO_ANNOTATE_CASE_ID || "";
const outcome = process.env.ECHO_ANNOTATE_OUTCOME as "manual_success" | "agent_failure" | undefined;

async function login() {
  const username = process.env.ECHO_PILOT_USERNAME || "";
  const password = process.env.ECHO_PILOT_PASSWORD || "";
  const response = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const rawCookie = response.headers.getSetCookie?.().find((value) => value.startsWith("echodrama_session=")) || response.headers.get("set-cookie") || "";
  const value = /echodrama_session=([^;]+)/.exec(rawCookie)?.[1];
  if (!response.ok || !value) throw new Error(`评测账户登录失败：${response.status}`);
  return `echodrama_session=${value}`;
}

async function main() {
  if (!runDir || !caseId || !outcome) throw new Error("需要 ECHO_ANNOTATE_RUN_DIR、ECHO_ANNOTATE_CASE_ID 和 ECHO_ANNOTATE_OUTCOME");
  const absoluteRunDir = path.resolve(runDir);
  const state = await readRunState(absoluteRunDir);
  if (!state) throw new Error("未找到 evaluation-state.json");
  const item = state.cases[caseId];
  if (!item?.canvasId) throw new Error(`${caseId} 缺少持久画布 ID`);
  const resultPath = path.join(absoluteRunDir, caseId, "result.json");
  const runPath = path.join(absoluteRunDir, "run.json");
  const [savedResult, savedRun] = await Promise.all([
    fs.readFile(resultPath, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => null),
    fs.readFile(runPath, "utf8").then((text) => JSON.parse(text) as { results: Array<Record<string, unknown>> }).catch(() => null),
  ]);
  // 支持在运行器被安全中止后对已持久化的画布补做归档/收尾；不丢失已成功的服务器输出。
  const result: Record<string, unknown> = savedResult || {
    id: caseId,
    title: caseId,
    modality: "unknown",
    canvasType: item.canvasType,
    startedAt: item.createdAt,
    finishedAt: "",
    canvasId: item.canvasId,
    canvasUrl: `${BASE_URL}/canvas/${item.canvasId}`,
    network: [],
    traceFiles: [],
    turns: [],
    channelAudit: { deepseekRequests: 0, workrallyRequests: 0, creditRequests: 0, audioBlocked: false },
  };
  const run = savedRun || { runId: state.runId, account: state.account, results: [] as Array<Record<string, unknown>> };

  if (outcome === "manual_success") {
    const cookie = await login();
    const archived = await archiveCanvasSnapshot({ runDir: absoluteRunDir, caseId, canvasId: item.canvasId, cookie, baseUrl: BASE_URL });
    const evidenceStatus = archived.manifest.media.some((media) => media.status === "error") ? "partial" : "complete";
    result.status = "completed";
    result.error = undefined;
    result.workspaceRevision = archived.canvas.revision || item.workspaceRevision;
    updateCaseState(state, caseId, { executionStatus: "completed", acceptanceStatus: "needs_review", evidenceStatus, interventionStatus: "human_confirmed", resumeCount: item.resumeCount + 1, workspaceRevision: archived.canvas.revision || item.workspaceRevision }, { type: "manual_intervention_confirmed", detail: "评测人员已在实际画布完成确认，已重新归档最新产物" });
  } else {
    result.status = "failed";
    result.error = "已由评测人员确认：Agent 未完成多参考视频生成能力要求。";
    updateCaseState(state, caseId, { executionStatus: "failed", acceptanceStatus: "failed", interventionStatus: "none" }, { type: "reviewer_marked_agent_failure", detail: "评测人员确认此 Case 为 Agent 能力失败，不重跑" });
  }

  const index = run.results.findIndex((entry) => entry.id === caseId);
  if (index < 0) run.results.push(result);
  else run.results[index] = result;
  await Promise.all([
    writeRunState(absoluteRunDir, state),
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`),
    fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ caseId, outcome, canvasId: item.canvasId }));
}

void main();

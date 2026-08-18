import fs from "node:fs/promises";
import path from "node:path";
import { archiveCanvasSnapshot } from "./evaluation-artifact-store";
import { loadEvaluationEnvironment } from "./evaluation-env";
import { readRunState, updateCaseState, writeRunState } from "./evaluation-run-state";

loadEvaluationEnvironment();

const BASE_URL = process.env.ECHO_WEB_BASE_URL || "http://127.0.0.1:3000";

async function login() {
  const username = process.env.ECHO_PILOT_USERNAME || "";
  const password = process.env.ECHO_PILOT_PASSWORD || "";
  if (!username || !password) throw new Error("恢复归档必须配置 ECHO_PILOT_USERNAME 与 ECHO_PILOT_PASSWORD");
  const response = await fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const rawCookie = response.headers.getSetCookie?.().find((value) => value.startsWith("echodrama_session=")) || response.headers.get("set-cookie") || "";
  const value = /echodrama_session=([^;]+)/.exec(rawCookie)?.[1];
  if (!response.ok || !value) throw new Error(`恢复账户登录失败：${response.status} ${await response.text()}`);
  return `echodrama_session=${value}`;
}

async function main() {
  const runDir = process.env.ECHO_RESUME_RUN_DIR || "";
  if (!runDir) throw new Error("请设置 ECHO_RESUME_RUN_DIR 为需要人工接管恢复的 Run 目录");
  const state = await readRunState(path.resolve(runDir));
  if (!state) throw new Error(`未找到评测状态文件：${runDir}`);
  const cookie = await login();
  const caseIds = (process.env.ECHO_CASE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const targets = Object.values(state.cases).filter((item) => item.executionStatus === "paused_for_human" && (!caseIds.length || caseIds.includes(item.caseId)));
  if (!targets.length) throw new Error("未找到等待人工确认的 Case");

  for (const item of targets) {
    if (!item.canvasId) throw new Error(`${item.caseId} 缺少持久画布 ID，不能恢复归档`);
    const archived = await archiveCanvasSnapshot({ runDir: path.resolve(runDir), caseId: item.caseId, canvasId: item.canvasId, cookie, baseUrl: BASE_URL });
    const evidenceStatus = archived.manifest.media.some((media) => media.status === "error") ? "partial" : "complete";
    updateCaseState(state, item.caseId, {
      executionStatus: "completed",
      acceptanceStatus: "needs_review",
      evidenceStatus,
      interventionStatus: "human_confirmed",
      resumeCount: item.resumeCount + 1,
      workspaceRevision: archived.canvas.revision || item.workspaceRevision,
    }, { type: "human_resume_archived", detail: "已重新归档人工确认后的持久画布；最终验收仍需审阅" });
  }
  await writeRunState(path.resolve(runDir), state);
  await fs.writeFile(path.join(path.resolve(runDir), "resume-last.json"), `${JSON.stringify({ resumedAt: new Date().toISOString(), caseIds: targets.map((item) => item.caseId) }, null, 2)}\n`);
  console.log(JSON.stringify({ runDir: path.resolve(runDir), resumedCaseIds: targets.map((item) => item.caseId) }, null, 2));
}

void main();

import fs from "node:fs/promises";
import path from "node:path";
import { loadEvaluationEnvironment } from "./evaluation-env";

loadEvaluationEnvironment();

const BASE_URL = process.env.ECHO_WEB_BASE_URL || "http://127.0.0.1:3000";
const RUNS_DIR = path.resolve(import.meta.dirname, "..", "runs");
const REPORT_PATH = path.join(RUNS_DIR, "evaluation-preflight-last.json");

type RequestResult = { ok: boolean; status: number; body: unknown };

async function request(url: string, init?: RequestInit): Promise<RequestResult> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

async function login() {
  const username = process.env.ECHO_PILOT_USERNAME || "";
  const password = process.env.ECHO_PILOT_PASSWORD || "";
  if (!username || !password) throw new Error("持久评测必须配置 ECHO_PILOT_USERNAME 与 ECHO_PILOT_PASSWORD；禁止创建临时评测账号");
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const cookie = response.headers.getSetCookie?.().find((value) => value.startsWith("echodrama_session=")) || response.headers.get("set-cookie") || "";
  const value = /echodrama_session=([^;]+)/.exec(cookie)?.[1];
  if (!response.ok || !value) throw new Error(`评测账户登录失败：${response.status} ${await response.text()}`);
  return { username, cookie: `echodrama_session=${value}` };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const web = await request(`${BASE_URL}/api/auth/me`);
  let account: { username: string; cookie: string } | null = null;
  let workspace: RequestResult | null = null;
  let error: string | null = null;
  try {
    account = await login();
    workspace = await request(`${BASE_URL}/api/workspace/bootstrap`, { headers: { cookie: account.cookie } });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const report = {
    checkedAt,
    baseUrl: BASE_URL,
    persistentProfileDirectory: process.env.ECHO_PILOT_ALLOW_SHARED_PROFILE === "true" && process.env.ECHO_PILOT_PROFILE_DIR ? process.env.ECHO_PILOT_PROFILE_DIR : "每个新 Run 的 runs/<run-id>/playwright-profile",
    webReachable: web.ok || web.status === 401,
    account: account ? { username: account.username, authenticated: Boolean(workspace?.ok) } : null,
    workspace: workspace ? { status: workspace.status, initialized: Boolean((workspace.body as { initialized?: boolean } | null)?.initialized), body: workspace.body } : null,
    readyForBatch: Boolean(account && workspace?.ok),
    error,
  };
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2));
  if (!report.readyForBatch) process.exitCode = 2;
}

void main();

import fs from "node:fs/promises";
import path from "node:path";

const RUNS_DIR = path.resolve(import.meta.dirname, "..", "runs");
const PROTECTED_RUN_IDS = new Set([
  "echo-pilot-2026-08-13T04-27-28-319Z",
  "gs-full-1",
]);
const LEGACY_SMOKE_RUN_IDS = new Set([
  "echo-pilot-2026-08-13T02-39-43-030Z",
  "echo-pilot-2026-08-13T02-48-28-533Z",
  "echo-pilot-2026-08-13T02-50-20-676Z",
  "echo-pilot-2026-08-13T02-56-28-227Z",
  "echo-pilot-2026-08-13T03-06-52-608Z",
  "echo-pilot-2026-08-13T03-10-14-000Z",
  "echo-pilot-2026-08-13T03-19-03-392Z",
  "echo-pilot-2026-08-13T03-34-19-651Z",
  "echo-pilot-2026-08-13T03-43-56-387Z",
  "echo-pilot-2026-08-13T03-54-17-253Z",
  "echo-pilot-2026-08-13T04-00-34-177Z",
  "echo-pilot-2026-08-13T04-10-25-049Z",
  "echo-pilot-2026-08-13T04-18-01-928Z",
  "echo-pilot-2026-08-13T04-22-43-571Z",
  "echo-pilot-2026-08-13T04-24-10-390Z",
]);

type CleanupAction = "report" | "delete" | "blocked";
type Candidate = {
  runId: string;
  path: string;
  action: CleanupAction;
  reason: string;
  fileCount: number;
  bytes: number;
  hasRunJson: boolean;
};

type Arguments = {
  apply: boolean;
  runId?: string;
  confirm?: string;
};

function parseArguments(argv: string[]): Arguments {
  const result: Arguments = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--run") result.runId = argv[++index];
    else if (value === "--confirm") result.confirm = argv[++index];
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

async function summarize(directory: string): Promise<Pick<Candidate, "fileCount" | "bytes">> {
  let fileCount = 0;
  let bytes = 0;
  const visit = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`拒绝处理包含符号链接的运行目录：${fullPath}`);
      if (stat.isDirectory()) await visit(fullPath);
      else if (stat.isFile()) {
        fileCount += 1;
        bytes += stat.size;
      }
    }
  };
  await visit(directory);
  return { fileCount, bytes };
}

async function assessmentReferences(runId: string): Promise<boolean> {
  const assessmentPath = path.resolve(import.meta.dirname, "..", "assessments", runId);
  return fs.access(assessmentPath).then(() => true).catch(() => false);
}

async function activeEvaluationProcesses(): Promise<string[]> {
  const entries = await fs.readdir(RUNS_DIR, { withFileTypes: true });
  const active: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".pid")) continue;
    const pidPath = path.join(RUNS_DIR, entry.name);
    const rawPid = await fs.readFile(pidPath, "utf8").catch(() => "");
    const pid = Number.parseInt(rawPid.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
      active.push(`${entry.name}:${pid}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") active.push(`${entry.name}:${pid}`);
    }
  }
  return active.sort();
}

async function candidateFor(runId: string): Promise<Candidate> {
  if (!LEGACY_SMOKE_RUN_IDS.has(runId)) throw new Error(`不是允许清理的历史 smoke Run：${runId}`);
  if (PROTECTED_RUN_IDS.has(runId)) throw new Error(`受保护 Run 不可清理：${runId}`);
  if (runId.includes("/") || runId.includes("\\") || runId.includes("..")) throw new Error(`非法 Run ID：${runId}`);

  const target = path.resolve(RUNS_DIR, runId);
  if (path.dirname(target) !== RUNS_DIR) throw new Error(`Run 路径越界：${runId}`);
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Run 不是可安全处理的真实目录：${runId}`);
  const [summary, hasRunJson, hasAssessment] = await Promise.all([
    summarize(target),
    fs.access(path.join(target, "run.json")).then(() => true).catch(() => false),
    assessmentReferences(runId),
  ]);
  return {
    runId,
    path: target,
    action: hasAssessment ? "blocked" : "report",
    reason: hasAssessment ? "存在 assessments 引用，拒绝清理" : "仅限首轮正式 Run 之前的明确 smoke/中断运行；默认只报告",
    ...summary,
    hasRunJson,
  };
}

async function writeManifest(payload: object) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const manifestPath = path.join(RUNS_DIR, `cleanup-manifest-${timestamp}.json`);
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(temporaryPath, manifestPath);
  return manifestPath;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.apply && (!args.runId || args.confirm !== args.runId)) {
    throw new Error("执行删除必须同时提供 --run <精确RunID> 与 --confirm <相同RunID>");
  }

  const activeProcesses = await activeEvaluationProcesses();
  const activeRunWriters = activeProcesses.filter((entry) => /^(echo-(pilot|cp|video-smoke)-.*\.pid:)/.test(entry));
  if (args.apply && activeRunWriters.length) {
    throw new Error(`检测到可能写入 Run 目录的活动评测进程，拒绝清理：${activeRunWriters.join(", ")}`);
  }

  const runIds = args.runId ? [args.runId] : [...LEGACY_SMOKE_RUN_IDS].sort();
  const candidates: Candidate[] = [];
  for (const runId of runIds) {
    try {
      candidates.push(await candidateFor(runId));
    } catch (error) {
      candidates.push({
        runId,
        path: path.resolve(RUNS_DIR, runId),
        action: "blocked",
        reason: error instanceof Error ? error.message : String(error),
        fileCount: 0,
        bytes: 0,
        hasRunJson: false,
      });
    }
  }

  if (args.apply) {
    const candidate = candidates[0];
    if (!candidate || candidate.action !== "report") throw new Error(`Run 不满足清理条件：${args.runId}`);
    await fs.rm(candidate.path, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
    candidate.action = "delete";
    candidate.reason = "已通过精确 Run ID 与双重确认删除；受保护 Run 未受影响";
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: args.apply ? "applied" : "dry-run",
    protectedRunIds: [...PROTECTED_RUN_IDS],
    activeProcesses,
    activeRunWriters,
    sharedPathsExcluded: ["echo-network-traces", "workrally-cli-traces", "workrally-video-progress"],
    candidates,
  };
  const manifestPath = await writeManifest(manifest);
  console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

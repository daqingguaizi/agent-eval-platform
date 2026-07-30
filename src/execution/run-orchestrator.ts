import { inspectDataset } from "@/lib/fs-store";
import { prisma } from "@/lib/prisma";
import { simulateTrace } from "@/sim/echo-sim";
import type { AgentConnectionConfig, EvalCase, ExecutionRequest, IsolationCapabilities } from "@/types";
import { createIsolationNamespace, caseWritesState, validateIsolation } from "./isolation";
import { persistExecutionEnvelope, persistNormalizedTrace } from "./persist-trace";
import { getExecutor } from "./registry";
import { scoreRun } from "@/scorers/router";

interface RunConfiguration {
  datasetFile: string;
  repeatOverride?: number;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function connectionConfig(connection: { id: string; agentId: string; protocol: string; endpoint: string | null; callbackPath: string | null; secretEnvRef: string | null; capabilities: string; timeoutMs: number }): AgentConnectionConfig {
  return {
    id: connection.id,
    agentId: connection.agentId,
    protocol: connection.protocol as AgentConnectionConfig["protocol"],
    endpoint: connection.endpoint ?? undefined,
    callbackPath: connection.callbackPath ?? undefined,
    secretEnvRef: connection.secretEnvRef ?? undefined,
    capabilities: parseJson<IsolationCapabilities>(connection.capabilities, { sandbox: false, rollback: false, testAccount: false, cleanupCallback: false, supportsWriteOperations: false }),
    timeoutMs: connection.timeoutMs,
  };
}

export async function createRunTrials(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { dataset: true } });
  if (!run?.dataset) throw new Error("Run 未关联数据集");
  const configuration = parseJson<RunConfiguration>(run.configuration, { datasetFile: run.dataset.filePath });
  const dataset = await inspectDataset(configuration.datasetFile);
  if (dataset.issues.length) throw new Error(`评测集校验失败：${dataset.issues.join("；")}`);
  const cases = dataset.cases.filter((item) => item.status === "active");
  for (const evalCase of cases) {
    const repeats = Math.min(Math.max(configuration.repeatOverride ?? evalCase.judge.consistency?.repeat ?? 1, 1), 20);
    for (let attempt = 1; attempt <= repeats; attempt += 1) {
      await prisma.runTrial.upsert({
        where: { runId_caseId_attempt: { runId, caseId: evalCase.id, attempt } },
        create: {
          runId,
          caseId: evalCase.id,
          caseSnapshot: JSON.stringify(evalCase),
          risk: evalCase.risk,
          scenario: evalCase.scenario,
          attempt,
          executorType: run.mode,
          timeoutMs: run.connectionId ? (await prisma.agentConnection.findUnique({ where: { id: run.connectionId } }))?.timeoutMs ?? 30000 : 30000,
        },
        update: {},
      });
    }
  }
  return cases.length;
}

export async function executeRun(runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { connection: true, dataset: true } });
  if (!run?.dataset) throw new Error("Run 或数据集不存在");
  await prisma.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
  await createRunTrials(runId);
  const trials = await prisma.runTrial.findMany({ where: { runId, status: "queued" }, orderBy: [{ caseId: "asc" }, { attempt: "asc" }] });
  const connection = run.connection ? connectionConfig(run.connection) : undefined;
  for (const trial of trials) {
    const evalCase = parseJson<EvalCase>(trial.caseSnapshot, {} as EvalCase);
    const capabilities = connection?.capabilities ?? { sandbox: false, rollback: false, testAccount: false, cleanupCallback: false, supportsWriteOperations: false };
    const isolationError = run.mode === "simulate" ? null : validateIsolation(evalCase, capabilities);
    if (isolationError) {
      await prisma.runTrial.update({ where: { id: trial.id }, data: { status: "rejected", errorMessage: isolationError, cleanupStatus: "not_required", finishedAt: new Date() } });
      continue;
    }
    const namespace = createIsolationNamespace(run.id, trial.id);
    await prisma.runTrial.update({ where: { id: trial.id }, data: { status: "running", startedAt: new Date(), isolationNamespace: namespace } });
    try {
      if (run.mode === "simulate") {
        const trace = simulateTrace(evalCase);
        trace.agentId = run.agentId;
        trace.caseId = trial.caseId;
        trace.runId = run.id;
        trace.trialId = trial.id;
        await persistNormalizedTrace(trace, `simulate:${trial.id}`);
        await prisma.runTrial.update({ where: { id: trial.id }, data: { status: "completed", finishedAt: new Date(), cleanupStatus: "not_required" } });
        continue;
      }
      if (!connection) throw new Error("真实执行 Run 缺少 Agent 连接");
      const executor = getExecutor(connection.protocol);
      if (!executor) throw new Error(`不支持执行协议：${connection.protocol}`);
      const request: ExecutionRequest = {
        protocolVersion: "v1",
        runId: run.id,
        trialId: trial.id,
        caseId: trial.caseId,
        agentId: run.agentId,
        evalCase,
        fixtureRefs: Array.isArray(evalCase.input.fixture_refs) ? evalCase.input.fixture_refs.filter((item): item is string => typeof item === "string") : [],
        isolation: { namespace, requireCleanup: caseWritesState(evalCase), writeOperation: caseWritesState(evalCase) },
        timeoutMs: trial.timeoutMs,
      };
      const result = await executor.execute(connection, request);
      if (result.status === "completed" && result.envelope) await persistExecutionEnvelope(result.envelope);
    } catch (error) {
      await prisma.runTrial.update({ where: { id: trial.id }, data: { status: "failed", errorMessage: error instanceof Error ? error.message : String(error), cleanupStatus: "failed", finishedAt: new Date() } });
    }
  }
  const status = await refreshRunStatus(runId);
  if (status.run.status === "executed") await scoreRun(runId);
  return status;
}

export async function refreshRunStatus(runId: string) {
  const trials = await prisma.runTrial.findMany({ where: { runId } });
  const pendingCallbacks = trials.some((trial) => trial.status === "running");
  const queued = trials.some((trial) => trial.status === "queued");
  const status = pendingCallbacks ? "awaiting_callback" : queued ? "queued" : "executed";
  const run = await prisma.run.update({ where: { id: runId }, data: { status, ...(status === "executed" ? { finishedAt: new Date() } : {}) } });
  return { run, trials };
}

export async function executeNextQueuedRun() {
  const next = await prisma.run.findFirst({ where: { status: "queued" }, orderBy: { queuedAt: "asc" } });
  return next ? executeRun(next.id) : null;
}

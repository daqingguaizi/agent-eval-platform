// 用例编排器：加载 cases/*.yaml，为每条用例开独立 thread + 重置空白画布，逐轮驱动，
// 采集 trace 并落盘。支持 --cases/--from/--repeat/--run-id/--turn-timeout。
// 单条失败隔离不中断整批。
import crypto from "node:crypto";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { HeadlessCanvasClient, type ToolExecutionRecord } from "./headless-canvas";
import { generateWithWorkRally } from "./workrally-generation";
import { readCanvasAgentConfig, newThread, sendTurn, deleteThread, agentPrompt, agentPromptSha } from "./codex-driver";
import { buildTrace, writeTrace, writeIndex, type RawAgentEvent, type CaseIndexEntry, type TurnTraceInput } from "./trace";
import { deepClone } from "./canvas-snapshot";
import { loadPilotCollection } from "./pilot-case-loader";
import { buildComposerAttachments, collectCanvasMedia, preparePilotMedia } from "./media-fixtures";
import { assertTargetUnchanged, fingerprintTarget, getAndVerifyAgentWorkspace, type TargetFingerprint } from "./target-readonly-guard";
import type { GoldenCase, CanvasType, PilotCase, TargetProtection } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.resolve(HERE, "..", "cases");
const RUNS_DIR = path.resolve(HERE, "..", "runs");
const CODEX_HOME = path.resolve(HERE, "..", "codex-home");
const CONTRACT_FILE = path.resolve(HERE, "..", "..", "standards", "canvas-agent.yaml");

function sha256Text(text: string | Buffer) {
    return crypto.createHash("sha256").update(text).digest("hex");
}

type Args = {
    cases?: string;
    from?: string;
    repeat?: number;
    repeatPolicy?: "case" | "stability";
    runId?: string;
    turnTimeoutMs?: number;
    list?: boolean;
    convert?: boolean;
    collection?: "golden-set" | "creation-usability-pilot";
};

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cases") args.cases = argv[++i];
        else if (a === "--from") args.from = argv[++i];
        else if (a === "--repeat") args.repeat = Number(argv[++i]);
        else if (a === "--repeat-policy") {
            const policy = argv[++i];
            if (policy === "case" || policy === "stability") args.repeatPolicy = policy;
            else throw new Error("--repeat-policy 仅支持 case 或 stability");
        }
        else if (a === "--run-id") args.runId = argv[++i];
        else if (a === "--turn-timeout") args.turnTimeoutMs = Number(argv[++i]);
        else if (a === "--list") args.list = true;
        else if (a === "--convert") args.convert = true;
        else if (a === "--collection") {
            const collection = argv[++i];
            if (collection === "golden-set" || collection === "creation-usability-pilot") args.collection = collection;
            else throw new Error("--collection 仅支持 golden-set 或 creation-usability-pilot");
        }
    }
    return args;
}

async function loadCases(): Promise<GoldenCase[]> {
    const files = (await fsAsync.readdir(CASES_DIR)).filter((f) => f.endsWith(".yaml")).sort();
    const cases: GoldenCase[] = [];
    for (const file of files) {
        const text = await fsAsync.readFile(path.join(CASES_DIR, file), "utf8");
        cases.push(yaml.load(text) as GoldenCase);
    }
    return cases;
}

function extractUsage(events: RawAgentEvent[]) {
    const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    for (const ev of events) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; usage?: Record<string, number> };
        if (data.type === "turn.completed" && data.usage) {
            usage.input_tokens = data.usage.input_tokens ?? usage.input_tokens;
            usage.output_tokens = data.usage.output_tokens ?? usage.output_tokens;
            usage.cached_input_tokens = data.usage.cached_input_tokens ?? usage.cached_input_tokens;
            usage.reasoning_output_tokens = data.usage.reasoning_output_tokens ?? usage.reasoning_output_tokens;
        }
    }
    return usage;
}

function extractFinalOutput(events: RawAgentEvent[]): string {
    let last = "";
    for (const ev of events) {
        if (ev.type !== "agent_event") continue;
        const data = ev.data as { type?: string; item?: { type?: string; text?: string } };
        const item = data?.item;
        if (item && item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) last = item.text;
    }
    return last;
}

function readCanvasAgentVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(HERE, "..", "..", "..", "products", "echo-infinite-canvas-main", "canvas-agent", "package.json"), "utf8"));
        return pkg.version || "unknown";
    } catch {
        return "unknown";
    }
}

function parseCanvasType(t: string): CanvasType {
    return t === "story" ? "story" : "content";
}

function attemptsFor(caseDef: GoldenCase, args: Args) {
    if (args.repeat != null) return Math.max(1, args.repeat);
    if (args.repeatPolicy === "case") return Math.max(1, caseDef.consistency?.repeat || 1);
    if (args.repeatPolicy === "stability") return caseDef.risk === "P0" ? 5 : caseDef.risk === "P1" ? 3 : 1;
    return 1;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.convert) {
        const { convertAll } = await import("./md-to-yaml");
        const result = convertAll();
        if (result.errors.length) {
            console.error("转换失败：");
            for (const e of result.errors) console.error("  - " + e);
            process.exit(1);
        }
        console.log(`转换成功：${result.written} 条用例写入 ${CASES_DIR}`);
        return;
    }

    const pilotCollection = args.collection === "creation-usability-pilot" ? await loadPilotCollection() : null;
    const cases: Array<GoldenCase | PilotCase> = pilotCollection ? pilotCollection.cases : await loadCases();
    if (args.list) {
        for (const c of cases) {
            console.log(`${c.id}\t${c.risk}\t${c.sampleType}\t${c.canvasType}\t${c.title}`);
        }
        console.log(`共 ${cases.length} 条`);
        return;
    }

    if (!cases.length) {
        console.error("没有找到 YAML 用例，请先运行 --convert 生成。");
        process.exit(1);
    }

    const { url, token } = readCanvasAgentConfig();
    if (!token) {
        console.error("无法读取 ~/.infinite-canvas/canvas-agent.json 的 token，请先启动 canvas-agent。");
        process.exit(1);
    }

    // 检查 canvas-agent 是否存活
    try {
        const health = await fetch(`${url}/health`);
        if (!health.ok) throw new Error(`HTTP ${health.status}`);
    } catch {
        console.error(`无法连接 canvas-agent（${url}）。请先启动：`);
        console.error(`  cd canvas-agent && CODEX_HOME=${CODEX_HOME} DEEPSEEK_API_KEY=<你的key> npm run dev`);
        console.error("（启动前请确认已设置 DEEPSEEK_API_KEY 环境变量）");
        process.exit(1);
    }

    const targetFingerprint = await fingerprintTarget();
    console.log(`只读保护：已校验 ${targetFingerprint.files} 个目标源码文件，指纹 ${targetFingerprint.manifestSha256.slice(0, 12)}`);

    const runId = args.runId || `run-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    const runDir = path.join(RUNS_DIR, runId);
    await fsAsync.mkdir(runDir, { recursive: true });
    await fsAsync.mkdir(path.join(runDir, "artifacts"), { recursive: true });

    // 过滤用例
    let selected = cases;
    if (args.cases) {
        const ids = args.cases.split(",").map((s) => s.trim());
        selected = cases.filter((c) => ids.includes(c.id));
    } else if (args.from) {
        const fromIdx = cases.findIndex((c) => c.id === args.from);
        selected = fromIdx >= 0 ? cases.slice(fromIdx) : cases;
    }
    const totalTrials = selected.reduce((sum, caseDef) => sum + attemptsFor(caseDef, args), 0);
    const repeatLabel = args.repeat != null ? `${args.repeat} 次` : args.repeatPolicy === "case" ? "按 Case consistency.repeat" : args.repeatPolicy === "stability" ? "按风险（P0×5 / P1×3 / P2×1）" : "默认 N=1";
    console.log(`[${runId}] 待跑 ${selected.length} 条 / ${totalTrials} Trial（${repeatLabel}），模型 deepseek，url ${url}`);
    console.log(`提示：CODEX_HOME=${CODEX_HOME}`);

    const indexEntries: CaseIndexEntry[] = [];
    const generationCtx = { artifactsDir: path.join(runDir, "artifacts") };
    const clientId = `gs-client-${runId}`;

    const client: HeadlessCanvasClient = new HeadlessCanvasClient(
        "content",
        clientId,
        url,
        token,
        {
            onHello: () => {},
            onToolCall: () => {},
            onAgentEvent: () => {},
            onToolExecuted: () => {},
            onStateChanged: () => {},
        },
        // generation executor：访问当前 snapshot
        (op) => generateWithWorkRally(op, client.getSnapshot(), generationCtx),
    );
    client.connect();

    const turnTimeoutMs = args.turnTimeoutMs ?? 180000;
    const agentPromptText = await agentPrompt();
    const startedAt = Date.now();
    let ok = 0;
    let fail = 0;
    let readonlyFailure: string | undefined;
    let batchBlockReason: string | undefined;
    caseLoop: for (const caseDef of selected) {
        const repeat = attemptsFor(caseDef, args);
        for (let attempt = 1; attempt <= repeat; attempt++) {
            process.stdout.write(`[${caseDef.id} attempt ${attempt}] 开始...`);
            const result = await runCase({
                runId,
                caseDef,
                attempt,
                url,
                token,
                turnTimeoutMs,
                runDir,
                client,
                indexEntries,
                canvasAgentVersion: readCanvasAgentVersion(),
                agentPromptText,
                caseRepeat: repeat,
                targetFingerprint,
            });
            if (result.ok) {
                ok++;
                process.stdout.write(` ✓\n`);
            } else {
                fail++;
                process.stdout.write(` ✗\n`);
            }
            if (result.stopBatch) {
                batchBlockReason = result.message || "首轮运行报告不可继续的阻塞状态";
                console.error(`  [批量阻塞] ${batchBlockReason}`);
            }
            try {
                assertTargetUnchanged(targetFingerprint, await fingerprintTarget());
            } catch (error) {
                readonlyFailure = error instanceof Error ? error.message : String(error);
                console.error(`  [只读保护] ${readonlyFailure}`);
            }
            // 增量写 index，跑测中断也不丢已完成结果，viewer 可看进度
            await writeIndex(runDir, indexEntries, {
                runId,
                model: "deepseek-chat",
                provider: "deepseek",
                canvasAgentVersion: readCanvasAgentVersion(),
                collection: pilotCollection ? { id: pilotCollection.id, version: pilotCollection.version, sha256: pilotCollection.sha256, scoring: "disabled" } : { id: "golden-set" },
                targetProtection: { sourceFingerprint: targetFingerprint.manifestSha256, checkedFiles: targetFingerprint.files, status: readonlyFailure ? "polluted" : "verified", reason: readonlyFailure },
                batchBlockReason,
                startedAt,
                totalCases: totalTrials,
                ok,
                fail,
            });
            if (readonlyFailure || batchBlockReason) break caseLoop;
        }
    }

    await writeIndex(runDir, indexEntries, {
        runId,
        model: "deepseek-chat",
        provider: "deepseek",
        canvasAgentVersion: readCanvasAgentVersion(),
        collection: pilotCollection ? { id: pilotCollection.id, version: pilotCollection.version, sha256: pilotCollection.sha256, scoring: "disabled" } : { id: "golden-set" },
        targetProtection: { sourceFingerprint: targetFingerprint.manifestSha256, checkedFiles: targetFingerprint.files, status: readonlyFailure ? "polluted" : "verified", reason: readonlyFailure },
        startedAt,
        finishedAt: Date.now(),
        totalCases: totalTrials,
        ok,
        fail,
    });
    await client.close();

    console.log(`\n完成：成功 ${ok}，失败 ${fail}。`);
    console.log(`Trace 目录：${runDir}`);
    console.log(`查看：python3 -m http.server 8000 后打开 viewer/index.html`);
}

type RunCaseParams = {
    runId: string;
    caseDef: GoldenCase | PilotCase;
    attempt: number;
    url: string;
    token: string;
    turnTimeoutMs: number;
    runDir: string;
    client: HeadlessCanvasClient;
    indexEntries: CaseIndexEntry[];
    canvasAgentVersion: string;
    agentPromptText: string | null;
    caseRepeat: number;
    targetFingerprint: TargetFingerprint;
};

async function runCase(params: RunCaseParams): Promise<{ ok: boolean; stopBatch?: boolean; message?: string }> {
    const { runId, caseDef, attempt, url, token, turnTimeoutMs, runDir, client, indexEntries, canvasAgentVersion, agentPromptText, caseRepeat, targetFingerprint } = params;
    const canvasId = `gs-${caseDef.id}-${attempt}-${Date.now()}`;
    const sessionId = canvasId;
    const rawEvents: RawAgentEvent[] = [];
    let eventSequence = 0;
    const turnInputs: TurnTraceInput[] = [];
    const isPilotCase = "pilot" in caseDef;
    let inputMedia: import("./types").MediaArtifact[] = [];
    let threadId = "";
    let targetProtection: TargetProtection = {
        sourceFingerprint: targetFingerprint.manifestSha256,
        checkedFiles: targetFingerprint.files,
        status: "blocked",
        reason: "尚未完成目标只读和 workspace 隔离验证",
    };

    // 客户端事件回调：收集原始事件
    client.onAgentEvent = (type: string, data: unknown) => {
        rawEvents.push({ type, data, at: Date.now(), seq: ++eventSequence });
    };

    try {
        assertTargetUnchanged(targetFingerprint, await fingerprintTarget());
        const workspace = await getAndVerifyAgentWorkspace(url, token, canvasId);
        targetProtection = {
            sourceFingerprint: targetFingerprint.manifestSha256,
            checkedFiles: targetFingerprint.files,
            workspacePath: workspace.workspacePath,
            workspaceCanvasId: workspace.canvasId,
            status: "verified",
        };

        // 重置为空白画布（用例画布类型）并上报；试点视频前置接入走目标产品相同的画布执行层。
        client.reset(caseDef.canvasType);
        await client.postStatePublic();
        if (isPilotCase) {
            const fixtures = await preparePilotMedia(caseDef);
            inputMedia = fixtures.inputMedia;
            if (fixtures.setupOps.length) {
                const applied = await client.applyFixtureOps(fixtures.setupOps);
                const rejections = applied.rejections || [];
                rawEvents.push({ type: "runner_fixture", data: { setupOps: fixtures.setupOps, rejections, inputMedia }, at: Date.now(), seq: ++eventSequence });
                if (rejections.length) throw new Error(`媒体前置接入被产品执行层拒绝：${rejections.map((item) => item.reason).join("；")}`);
            }
        }

        threadId = await newThread(url, token, canvasId);

        for (const turn of caseDef.input.turns) {
            const turnStartIdx = rawEvents.length;
            const startedAt = Date.now();
            const userMessage = turn.message;
            const actualPrompt = agentPromptText ? `${agentPromptText}\n\n[USER_MESSAGE]\n${userMessage}` : userMessage;

            const attachments = isPilotCase ? caseDef.pilot.turns.find((candidate) => candidate.index === turn.index)?.attachments || [] : [];
            await sendTurn(url, token, canvasId, userMessage, threadId, isPilotCase ? await buildComposerAttachments(attachments) : []);

            // 等待 agent_done；agent_error 立即返回，避免首轮生命周期异常占满默认超时。
            const completion = await client.waitForAgentDone(turnTimeoutMs);
            const endedAt = Date.now();
            const turnEvents = rawEvents.slice(turnStartIdx);
            const usage = extractUsage(turnEvents);
            const output = extractFinalOutput(turnEvents);
            const clientRecords = client.getRecords().filter((r) => r.startedAt >= startedAt - 1000 && r.startedAt <= endedAt);

            turnInputs.push({
                index: turn.index,
                purpose: turn.purpose,
                userMessage,
                actualPrompt,
                rawEvents: turnEvents,
                clientRecords,
                output,
                startedAt,
                endedAt,
                usage,
            });

            if (completion.status === "agent_error") {
                throw new Error(`第 ${turn.index} 轮 Agent 生命周期错误：${completion.error || "未知错误"}`);
            }
            if (completion.status === "timeout") {
                throw new Error(`第 ${turn.index} 轮超时（${turnTimeoutMs}ms）`);
            }
        }

        // 等待挂起的生成任务
        await client.waitForPendingGenerations();

        const versions = {
            canvasAgent: canvasAgentVersion,
            codex: "0.139.0",
            model: "deepseek-chat",
            provider: "deepseek",
            agentPromptSha: await agentPromptSha(),
        };
        const caseFile = path.join(CASES_DIR, `${caseDef.id}.yaml`);
        const provenance = {
            traceSchemaVersion: 2 as const,
            status: agentPromptText ? "complete" as const : "partial" as const,
            caseSha256: isPilotCase ? caseDef.pilot.sourceSha256 : (fs.existsSync(caseFile) ? sha256Text(fs.readFileSync(caseFile)) : undefined),
            contractSha256: fs.existsSync(CONTRACT_FILE) ? sha256Text(fs.readFileSync(CONTRACT_FILE)) : undefined,
            promptTemplateSha256: agentPromptText ? sha256Text(agentPromptText) : undefined,
            environment: { node: process.version, platform: process.platform, command: process.argv.slice(1).join(" ") },
            fixture: { status: "unknown" as const, notes: "当前无外部fixture快照；评分时需按标准处理可能的数据漂移。" },
            eventSequence: true,
        };
        const trace = buildTrace({
            runId,
            caseId: caseDef.id,
            sessionId,
            attempt,
            golden: caseDef,
            turns: turnInputs,
            finalState: deepClone(client.getSnapshot()),
            versions,
            config: { canvasType: caseDef.canvasType, codexHome: CODEX_HOME, repeat: caseRepeat },
            rawEventsFile: `raw/${caseDef.id}-${attempt}.jsonl`,
            inputMedia,
            artifacts: collectCanvasMedia(client.getSnapshot()),
            targetProtection,
            executionStatus: "complete",
            provenance,
        });

        await writeTrace(runDir, trace, rawEvents);
        const hasRejections = trace.turns.some((t) => t.steps.some((s) => s.rejections?.length));
        const hasErrors = trace.errors.length > 0;
        indexEntries.push({
            case_id: caseDef.id,
            title: caseDef.title,
            scenario: caseDef.scenario,
            risk: caseDef.risk,
            sampleType: caseDef.sampleType,
            canvasType: caseDef.canvasType,
            attempt,
            turns: trace.turns.length,
            toolCalls: trace.usage.tool_calls,
            hasRejections,
            hasErrors,
            exceededBudget: trace.budget.exceeded,
            latencyMs: trace.usage.latency_ms,
            status: "complete",
            modality: isPilotCase ? caseDef.pilot.modality : undefined,
            inputMedia: trace.inputMedia,
            artifacts: trace.artifacts,
            traceFile: `traces/${caseDef.id}-${attempt}.json`,
        });
        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (targetProtection.status !== "verified") targetProtection = { ...targetProtection, reason: message };
        const executionStatus = targetProtection.status !== "verified"
            ? "blocked" as const
            : /超时|timeout/i.test(message) ? "timeout" as const : "failed" as const;
        console.error(`  [${caseDef.id}] ${executionStatus === "blocked" ? "阻塞" : "失败"}：${message}`);
        const trace = buildTrace({
            runId,
            caseId: caseDef.id,
            sessionId,
            attempt,
            golden: caseDef,
            turns: turnInputs,
            finalState: deepClone(client.getSnapshot()),
            versions: { canvasAgent: canvasAgentVersion, codex: "0.139.0", model: "deepseek-chat", provider: "deepseek", agentPromptSha: await agentPromptSha() },
            config: { canvasType: caseDef.canvasType, codexHome: CODEX_HOME, repeat: caseRepeat },
            rawEventsFile: `raw/${caseDef.id}-${attempt}.jsonl`,
            inputMedia,
            artifacts: collectCanvasMedia(client.getSnapshot()),
            targetProtection,
            executionStatus,
            additionalErrors: [{ scope: executionStatus, message }],
            provenance: {
                traceSchemaVersion: 2,
                status: agentPromptText ? "complete" : "partial",
                caseSha256: isPilotCase ? caseDef.pilot.sourceSha256 : undefined,
                contractSha256: fs.existsSync(CONTRACT_FILE) ? sha256Text(fs.readFileSync(CONTRACT_FILE)) : undefined,
                promptTemplateSha256: agentPromptText ? sha256Text(agentPromptText) : undefined,
                environment: { node: process.version, platform: process.platform, command: process.argv.slice(1).join(" ") },
                fixture: { status: "unknown", notes: "失败前已保留可获得的媒体fixture与最终快照。" },
                eventSequence: true,
            },
        });
        await writeTrace(runDir, trace, rawEvents);
        indexEntries.push({
            case_id: caseDef.id,
            title: caseDef.title,
            scenario: caseDef.scenario,
            risk: caseDef.risk,
            sampleType: caseDef.sampleType,
            canvasType: caseDef.canvasType,
            attempt,
            turns: trace.turns.length,
            toolCalls: trace.usage.tool_calls,
            hasRejections: trace.turns.some((turn) => turn.steps.some((step) => step.rejections?.length)),
            hasErrors: true,
            exceededBudget: trace.budget.exceeded,
            latencyMs: trace.usage.latency_ms,
            status: executionStatus,
            modality: isPilotCase ? caseDef.pilot.modality : undefined,
            inputMedia: trace.inputMedia,
            artifacts: trace.artifacts,
            traceFile: `traces/${caseDef.id}-${attempt}.json`,
        });
        return { ok: false, stopBatch: executionStatus === "blocked" || /Agent 生命周期错误/.test(message), message };
    } finally {
        if (threadId) await deleteThread(url, token, canvasId, threadId).catch(() => {});
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { archiveCanvasSnapshot } from "./evaluation-artifact-store";
import { loadEvaluationEnvironment } from "./evaluation-env";
import { createRunState, initializeCaseState, updateCaseState, writeRunState } from "./evaluation-run-state";
import { loadPilotCollection } from "./pilot-case-loader";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
loadEvaluationEnvironment();

const BASE_URL = process.env.ECHO_WEB_BASE_URL || "http://127.0.0.1:3000";
const TRACE_DIR = path.resolve(import.meta.dirname, "..", "runs", "echo-network-traces");
const RUN_ID = `echo-pilot-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
const RUN_DIR = path.resolve(import.meta.dirname, "..", "runs", RUN_ID);
// 每个 Run 都有独立且可保留的 Profile；仅在显式允许时才接受共享目录，避免环境残留污染 IndexedDB/localForage 数据。
const PROFILE_DIR = path.resolve(process.env.ECHO_PILOT_ALLOW_SHARED_PROFILE === "true" && process.env.ECHO_PILOT_PROFILE_DIR
    ? process.env.ECHO_PILOT_PROFILE_DIR
    : path.join(RUN_DIR, "playwright-profile"));
// 生成任务必须保持页面存活直到工作区写入最终产物；为长视频单独保留更长的完成窗口，不能在短超时后关闭页面。
const CASE_TIMEOUT_MS = Number(process.env.ECHO_CASE_TIMEOUT_MS || 600_000);
const GENERATION_TIMEOUT_MS = Number(process.env.ECHO_GENERATION_TIMEOUT_MS || 1_800_000);
const WORKSPACE_SYNC_TIMEOUT_MS = Number(process.env.ECHO_WORKSPACE_SYNC_TIMEOUT_MS || 45_000);
const CONFIRMATION_MODE = process.env.ECHO_CONFIRMATION_MODE === "human" ? "human" : "auto";

const echoConfig = {
    channelMode: "remote",
    baseUrl: "http://127.0.0.1:19998/v1",
    apiKey: "local-evaluation",
    apiFormat: "openai",
    channels: [
        { id: "deepseek-local", name: "DeepSeek（评测）", baseUrl: "http://127.0.0.1:19998/v1", apiKey: "local-evaluation", apiFormat: "openai", models: ["deepseek-chat"], modelLabels: {} },
        { id: "workrally-local", name: "WorkRally CLI（评测）", baseUrl: "local:workrally", apiKey: "", apiFormat: "workrally", models: ["workrally-image:8zueiutezp", "workrally-video:qa3zsyxzc8"], modelLabels: { "workrally-image:8zueiutezp": "WorkRally Image", "workrally-video:qa3zsyxzc8": "WorkRally 梦宝-2.0" } },
    ],
    model: "deepseek-local::deepseek-chat",
    textModel: "deepseek-local::deepseek-chat",
    imageModel: "workrally-local::workrally-image:8zueiutezp",
    videoModel: "workrally-local::workrally-video:qa3zsyxzc8",
    audioModel: "",
    models: ["deepseek-local::deepseek-chat", "workrally-local::workrally-image:8zueiutezp", "workrally-local::workrally-video:qa3zsyxzc8"],
    textModels: ["deepseek-local::deepseek-chat"],
    imageModels: ["workrally-local::workrally-image:8zueiutezp"],
    videoModels: ["workrally-local::workrally-video:qa3zsyxzc8"],
    audioModels: [],
};

type CaseResult = {
    id: string;
    title: string;
    modality: string;
    status: "completed" | "blocked" | "failed";
    startedAt: string;
    finishedAt: string;
    canvasUrl?: string;
    canvasId?: string;
    canvasType?: "content" | "story";
    workspaceRevision?: number;
    turns: Array<{ index: number; purpose: string; message: string; attachments: string[]; elapsedMs: number; status: string; error?: string }>;
    network: Array<{ url: string; status: number; method: string }>;
    traceFiles: string[];
    screenshot?: string;
    screenshotMeta?: { kind: "final" | "failure"; url: string; canvasId?: string; workspaceRevision?: number; migrationDialogVisible: boolean };
    generationRequired?: boolean;
    generationVerified?: boolean;
    generatedOutputNodeIds?: string[];
    channelAudit: { deepseekRequests: number; workrallyRequests: number; creditRequests: number; audioBlocked: boolean };
    error?: string;
};

function resourcePath(resource: { fileName: string; sourceDirectory?: string }) {
    if (!resource.sourceDirectory) throw new Error(`资源缺少来源目录：${resource.fileName}`);
    return path.join(resource.sourceDirectory, resource.fileName);
}

async function createEvaluationSession() {
    const username = process.env.ECHO_PILOT_USERNAME || "";
    const password = process.env.ECHO_PILOT_PASSWORD || "";
    if (!username || !password) throw new Error("第二轮评测必须配置 ECHO_PILOT_USERNAME 与 ECHO_PILOT_PASSWORD，禁止创建临时账号");
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw new Error(`无法登录持久 Echo 评测账户：${response.status} ${await response.text()}`);
    const cookie = response.headers.getSetCookie?.().find((value) => value.startsWith("echodrama_session=")) || response.headers.get("set-cookie") || "";
    const value = /echodrama_session=([^;]+)/.exec(cookie)?.[1];
    if (!value) throw new Error("登录成功但未收到 echodrama_session Cookie");
    return { username, value };
}

async function assertRunWorkspaceIsolation(cookie: string, expectedCanvasIds: Set<string>) {
    const response = await fetch(`${BASE_URL}/api/workspace/bootstrap`, { headers: { cookie: `echodrama_session=${cookie}` } });
    if (!response.ok) throw new Error(`无法验证评测工作区隔离：${response.status} ${await response.text()}`);
    const workspace = await response.json() as { canvases?: Array<{ entityId?: string; deletedAt?: string | null }> };
    // 已软删除画布仍会随 bootstrap 返回，但不属于当前工作区，不能阻止新的正式重跑。
    const remoteCanvasIds = (workspace.canvases || [])
        .filter((canvas) => !canvas.deletedAt)
        .map((canvas) => canvas.entityId)
        .filter((id): id is string => Boolean(id));
    const unexpected = remoteCanvasIds.filter((id) => !expectedCanvasIds.has(id));
    const missing = [...expectedCanvasIds].filter((id) => !remoteCanvasIds.includes(id));
    if (unexpected.length || missing.length) {
        throw new Error(`评测工作区被外部会话污染或丢失：unexpected=${unexpected.join(",") || "无"}; missing=${missing.join(",") || "无"}`);
    }
}

async function waitForWorkspaceCanvas(cookie: string, canvasId: string, expectedType: "content" | "story") {
    const deadline = Date.now() + WORKSPACE_SYNC_TIMEOUT_MS;
    let lastReason = "工作区尚未返回画布";
    while (Date.now() < deadline) {
        const response = await fetch(`${BASE_URL}/api/workspace/canvases/${encodeURIComponent(canvasId)}`, {
            headers: { cookie: `echodrama_session=${cookie}` },
        });
        if (response.ok) {
            const record = await response.json() as { revision?: number; payload?: { canvasType?: string; nodes?: unknown[]; connections?: unknown[] } };
            if (record.payload?.canvasType === expectedType && Array.isArray(record.payload.nodes) && Array.isArray(record.payload.connections)) {
                return { revision: record.revision || 0, payload: record.payload };
            }
            lastReason = `画布类型或内容不完整：${record.payload?.canvasType || "unknown"}`;
        } else {
            lastReason = `${response.status} ${await response.text()}`;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`持久工作区未在 ${WORKSPACE_SYNC_TIMEOUT_MS}ms 内保存画布 ${canvasId}：${lastReason}`);
}

type PersistedMediaNode = {
    id?: string;
    type?: string;
    metadata?: { status?: string; content?: string; errorDetails?: string };
};

type PersistedGeneration = { revision: number; outputNodeIds: string[] };

function expectedOutputTypes(modality: string) {
    if (modality === "panorama") return new Set(["plugin:panorama"]);
    if (["t2v", "i2v"].includes(modality)) return new Set(["video"]);
    if (["t2i", "i2i"].includes(modality)) return new Set(["image"]);
    return new Set(["image", "video", "audio"]);
}

async function readPersistedCanvas(cookie: string, canvasId: string) {
    const response = await fetch(`${BASE_URL}/api/workspace/canvases/${encodeURIComponent(canvasId)}`, { headers: { cookie: `echodrama_session=${cookie}` } });
    if (!response.ok) throw new Error(`读取工作区返回 ${response.status}`);
    return response.json() as Promise<{ revision?: number; payload?: { nodes?: PersistedMediaNode[] } }>;
}

async function waitForPersistedGeneratedMedia(
    cookie: string,
    canvasId: string,
    modality: string,
    baselineNodeIds: Set<string>,
    deadline: number,
): Promise<PersistedGeneration> {
    let lastReason = "等待本次生成节点写入工作区";
    let stableSignature = "";
    let stablePolls = 0;
    const types = expectedOutputTypes(modality);
    while (Date.now() < deadline) {
        try {
            const record = await readPersistedCanvas(cookie, canvasId);
            const candidates = (record.payload?.nodes || []).filter((node) => !baselineNodeIds.has(node.id || "") && types.has(node.type || ""));
            const successful = candidates.filter((node) => node.metadata?.status === "success" && Boolean(node.metadata?.content));
            const loading = candidates.filter((node) => node.metadata?.status === "loading");
            const errors = candidates.filter((node) => node.metadata?.status === "error");
            if (errors.length && !loading.length) {
                throw new Error(`本次生成节点返回错误：${errors.map((node) => node.metadata?.errorDetails || "未知错误").join("；")}`);
            }
            if (successful.length && !loading.length) {
                const outputNodeIds = successful.map((node) => node.id).filter((id): id is string => Boolean(id)).sort();
                const signature = outputNodeIds.map((id) => `${id}:${successful.find((node) => node.id === id)?.metadata?.content}`).join("|");
                stablePolls = signature === stableSignature ? stablePolls + 1 : 1;
                stableSignature = signature;
                // 连续两次服务端读到相同成功输出，确认不是尚未落盘的中间态。
                if (stablePolls >= 2) return { revision: record.revision || 0, outputNodeIds };
                lastReason = `本次输出已成功，等待持久化稳定（${stablePolls}/2）`;
            } else {
                stablePolls = 0;
                stableSignature = "";
                lastReason = `本次成功输出 ${successful.length}，仍在生成 ${loading.length}`;
            }
        } catch (error) {
            lastReason = error instanceof Error ? error.message : String(error);
            if (lastReason.startsWith("本次生成节点返回错误")) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    throw new Error(`生成任务未在页面保持期间稳定持久化完成：${lastReason}`);
}

async function waitForAssistantSettled(page: Page, deadline: number, options: { requiresGeneration: boolean; generationRequested: () => boolean; pendingGenerations: () => number; generationCompletedAt: () => number }) {
    let quietSince = Date.now();
    let lastSnapshot = "";
    while (Date.now() < deadline) {
        const snapshot = await page.locator("body").innerText().catch(() => "");
        if (snapshot !== lastSnapshot) {
            quietSince = Date.now();
            lastSnapshot = snapshot;
        }
        const quietFor = Date.now() - quietSince;
        if (options.requiresGeneration) {
            const completedAt = options.generationCompletedAt();
            if (options.generationRequested() && options.pendingGenerations() === 0 && completedAt > 0 && Date.now() - completedAt >= 8_000) return;
            if (!options.generationRequested() && quietFor > 12_000) {
                throw new Error("Echo 已结束工具循环，但未发起要求的 WorkRally 生成请求");
            }
        } else if (quietFor > 6_000) {
            return;
        }
        await page.waitForTimeout(1_000);
    }
    const reason = options.requiresGeneration && !options.generationRequested() ? "未发起 WorkRally 生成请求" : "生成请求未完成";
    throw new Error(`等待 Echo Agent 收敛超时（${CASE_TIMEOUT_MS}ms）：${reason}`);
}

async function resolveLegacyWorkspaceDialog(page: Page) {
    const dialog = page.getByRole("dialog", { name: "发现这台设备上的旧工作区" });
    if (!await dialog.count() || !await dialog.isVisible()) return false;
    // 仅放弃 Runner 独立 Profile 中的本地遗留副本；不会调用任何服务端删除接口。
    await dialog.getByRole("button", { name: "暂不导入", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    return true;
}

async function waitForOfficialWorkspaceReady(page: Page) {
    const dialog = page.getByRole("dialog", { name: "发现这台设备上的旧工作区" });
    const syncStatus = page.getByRole("button", { name: "已同步到账号", exact: true });
    const deadline = Date.now() + 60_000;
    // 新 Profile 首次启动时先让云端工作区完整下拉；禁止在准备期创建本地画布，
    // 否则新画布会被同步层误判为“旧工作区”并阻塞服务器持久化。
    while (Date.now() < deadline) {
        if (await dialog.isVisible().catch(() => false)) {
            await resolveLegacyWorkspaceDialog(page);
            continue;
        }
        if (await syncStatus.isVisible().catch(() => false)) {
            await page.waitForTimeout(1_500);
            if (!await dialog.isVisible().catch(() => false)) return;
        }
        await page.waitForTimeout(250);
    }
    throw new Error("官方账号工作区未在 60000ms 内同步完成；为保护既有画布，拒绝创建新画布");
}

async function createCanvas(page: Page, canvasType: "content" | "story") {
    await page.goto(`${BASE_URL}/canvas`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForOfficialWorkspaceReady(page);
    // 空工作区同时显示顶部栏和空状态两个“新建画布”；评测必须固定使用顶部栏入口。
    const header = page.locator("header");
    const createButton = header.getByRole("button", { name: "新建画布", exact: true });
    await createButton.waitFor({ state: "visible", timeout: 30_000 });
    if (canvasType === "story") {
        // 主按钮会立即创建 content 画布；故事画布必须先点击右侧下拉箭头再选择菜单项。
        const storyMenuToggle = header.locator("button:has(svg.lucide-chevron-down)");
        await storyMenuToggle.click({ trial: true, timeout: 30_000 });
        await storyMenuToggle.click();
        await page.getByRole("menuitem", { name: "新建编排画布", exact: true }).click();
    } else {
        await createButton.click({ trial: true, timeout: 30_000 });
        await createButton.click();
    }
    await page.waitForURL(/\/canvas\/[^/]+/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Agent" }).waitFor({ state: "visible", timeout: 30_000 });
}

async function captureCaseScreenshot(page: Page, result: CaseResult, caseDir: string) {
    if (page.isClosed()) return;
    const url = page.url();
    const migrationDialogVisible = await page.getByRole("dialog", { name: "发现这台设备上的旧工作区" }).isVisible().catch(() => false);
    const isExpectedCanvas = Boolean(result.canvasId && new URL(url).pathname === `/canvas/${result.canvasId}`);
    const isFinalCanvas = isExpectedCanvas
        && result.status === "completed"
        && result.workspaceRevision !== undefined
        && (!result.generationRequired || result.generationVerified === true)
        && !migrationDialogVisible;
    const name = isFinalCanvas ? "final.png" : "failure.png";
    result.screenshot = path.join(result.id, name);
    result.screenshotMeta = { kind: isFinalCanvas ? "final" : "failure", url, canvasId: result.canvasId, workspaceRevision: result.workspaceRevision, migrationDialogVisible };
    await page.screenshot({ path: path.join(caseDir, name), fullPage: true });
}

async function uploadCanvasVideos(page: Page, files: string[]) {
    const input = page.locator('input[type="file"]').first();
    for (const file of files) {
        await input.setInputFiles(file);
        await page.waitForTimeout(2_000);
    }
}

async function uploadComposerAttachments(page: Page, files: string[]) {
    const input = page.locator('input[type="file"]').nth(1);
    for (const file of files) {
        await input.setInputFiles(file);
        await page.waitForTimeout(700);
    }
}

async function openEchoAgent(page: Page) {
    await page.getByRole("button", { name: "Agent" }).click();
    await page.waitForTimeout(400);
    const confirmation = page.getByRole("switch", { name: "工具确认" });
    if (CONFIRMATION_MODE === "auto" && await confirmation.count() && await confirmation.isChecked()) await confirmation.uncheck();
}

async function isWaitingForHumanConfirmation(page: Page) {
    const text = await page.locator("body").innerText().catch(() => "");
    return /确认(?:执行|生成|操作)|等待.*确认|请.*确认/.test(text);
}

async function sendTurn(page: Page, message: string) {
    const composer = page.locator("textarea").last();
    if (!await composer.count()) throw new Error("找不到 Echo Agent 输入框");
    await composer.fill(message);
    const submit = page.locator('button[type="submit"]').last();
    if (await submit.count() && await submit.isEnabled()) await submit.click();
    else await composer.press("Enter");
}

async function traceFilesSince(timestamp: number, target: string) {
    const files = await fs.readdir(TRACE_DIR).catch(() => [] as string[]);
    const selected: string[] = [];
    await fs.mkdir(target, { recursive: true });
    for (const file of files) {
        const source = path.join(TRACE_DIR, file);
        const stat = await fs.stat(source).catch(() => null);
        if (!stat || stat.mtimeMs < timestamp) continue;
        const destination = path.join(target, file);
        await fs.copyFile(source, destination);
        selected.push(file);
    }
    return selected.sort();
}

async function main() {
    await fs.mkdir(RUN_DIR, { recursive: true });
    const targetFingerprint = await fs.readFile(path.join(ROOT, "products", "echo-infinite-canvas-main", "VERSION"), "utf8");
    const collection = await loadPilotCollection();
    const requestedCaseIds = new Set((process.env.ECHO_CASE_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
    const cases = requestedCaseIds.size ? collection.cases.filter((caseDef) => requestedCaseIds.has(caseDef.id)) : collection.cases;
    if (!cases.length) throw new Error(`未找到请求的 Echo Case：${[...requestedCaseIds].join(", ")}`);
    const session = await createEvaluationSession();
    await fs.mkdir(PROFILE_DIR, { recursive: true });
    const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "echodrama_session", value: session.value, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript((config) => localStorage.setItem("infinite-canvas:ai_config_store", JSON.stringify({ state: { config }, version: 0 })), echoConfig);
    const workspaceBootstrap = await fetch(`${BASE_URL}/api/workspace/bootstrap`, { headers: { cookie: `echodrama_session=${session.value}` } });
    if (!workspaceBootstrap.ok) throw new Error(`持久工作区不可用，拒绝启动批测：${workspaceBootstrap.status} ${await workspaceBootstrap.text()}`);
    const evaluationState = createRunState(RUN_ID, session.username, PROFILE_DIR);
    // 局部重跑可声明保留 Case 的既有画布；未显式声明时仍强制为空工作区。
    const canvasIds = new Set((process.env.ECHO_ALLOWED_EXISTING_CANVAS_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
    await assertRunWorkspaceIsolation(session.value, canvasIds);
    await writeRunState(RUN_DIR, evaluationState);
    const results: CaseResult[] = [];

    for (const caseDef of cases) {
        initializeCaseState(evaluationState, caseDef.id, caseDef.canvasType);
        updateCaseState(evaluationState, caseDef.id, { executionStatus: "running" }, { type: "case_started" });
        await writeRunState(RUN_DIR, evaluationState);
        const startedAt = new Date().toISOString();
        const caseDir = path.join(RUN_DIR, caseDef.id);
        const network: CaseResult["network"] = [];
        let workrallyRequests = 0;
        let workrallyStarted = 0;
        let workrallyCompletedAt = 0;
        let deepseekRequests = 0;
        let creditRequests = 0;
        const pendingWorkrallyRequests = new Set<import("playwright").Request>();
        const result: CaseResult = {
            id: caseDef.id, title: caseDef.title, modality: caseDef.pilot.modality, status: "completed", startedAt, finishedAt: "", canvasType: caseDef.canvasType, turns: [], network, traceFiles: [], channelAudit: { deepseekRequests: 0, workrallyRequests: 0, creditRequests: 0, audioBlocked: caseDef.pilot.modality === "audio" },
        };
        let page: Page | null = null;
        try {
            page = await context.newPage();
            page.on("request", (request) => {
                if (request.url().includes("/api/workrally/")) {
                    workrallyStarted++;
                    pendingWorkrallyRequests.add(request);
                }
            });
            page.on("requestfinished", (request) => pendingWorkrallyRequests.delete(request));
            page.on("requestfailed", (request) => pendingWorkrallyRequests.delete(request));
            page.on("response", (response) => {
                const url = response.url();
                if (url.includes("127.0.0.1:19998")) deepseekRequests++;
                if (url.includes("/api/workrally/")) {
                    workrallyRequests++;
                    workrallyCompletedAt = Date.now();
                }
                if (url.includes("/api/generations")) creditRequests++;
                if (url.includes("127.0.0.1:19998") || url.includes("/api/workrally/") || url.includes("/api/generations")) network.push({ url, status: response.status(), method: response.request().method() });
            });
            await createCanvas(page, caseDef.canvasType);
            result.canvasUrl = page.url();
            result.canvasId = new URL(result.canvasUrl).pathname.split("/").at(-1);
            if (!result.canvasId) throw new Error("创建画布后无法解析画布 ID");
            if (canvasIds.has(result.canvasId)) throw new Error(`检测到重复画布 ID，拒绝继续评测：${result.canvasId}`);
            canvasIds.add(result.canvasId);
            const workspaceCanvas = await waitForWorkspaceCanvas(session.value, result.canvasId, caseDef.canvasType);
            await assertRunWorkspaceIsolation(session.value, canvasIds);
            result.workspaceRevision = workspaceCanvas.revision;
            updateCaseState(evaluationState, caseDef.id, { canvasId: result.canvasId, workspaceRevision: workspaceCanvas.revision }, { type: "canvas_persisted", detail: caseDef.canvasType });
            await writeRunState(RUN_DIR, evaluationState);
            const videoResources = caseDef.pilot.resourceRefs.filter((resource) => resource.mediaType === "video").map(resourcePath);
            if (videoResources.length) await uploadCanvasVideos(page, videoResources);
            await openEchoAgent(page);
            for (const turn of caseDef.pilot.turns) {
                if (turn.runnerSetup) continue;
                const attachmentFiles = turn.attachments.map(resourcePath);
                if (attachmentFiles.length) await uploadComposerAttachments(page, attachmentFiles);
                const turnStart = Date.now();
                const traceStart = Date.now() - 5;
                try {
                    const requiresGeneration = ["t2i", "i2i", "panorama", "t2v", "i2v"].includes(caseDef.pilot.modality) && turn.purpose === "target";
                    const workrallyBeforeTurn = workrallyStarted;
                    let baselineNodeIds = new Set<string>();
                    if (requiresGeneration && result.canvasId) {
                        // 以发送目标指令前的持久画布为基线，只认可本次新增的目标类型输出。
                        const baseline = await readPersistedCanvas(session.value, result.canvasId);
                        baselineNodeIds = new Set((baseline.payload?.nodes || []).map((node) => node.id).filter((id): id is string => Boolean(id)));
                        result.generationRequired = true;
                    }
                    const turnDeadline = turnStart + (requiresGeneration ? Math.max(CASE_TIMEOUT_MS, GENERATION_TIMEOUT_MS) : CASE_TIMEOUT_MS);
                    await sendTurn(page, turn.message);
                    if (requiresGeneration && result.canvasId) {
                        // 生成成功的权威信号是账号工作区中新节点已稳定持久化，而不是 Agent 面板是否停止追加文本。
                        // Agent 面板可在视频已完成后继续流式输出；此时不能阻塞归档和后续 Case。
                        const persisted = await waitForPersistedGeneratedMedia(session.value, result.canvasId, caseDef.pilot.modality, baselineNodeIds, turnDeadline);
                        result.workspaceRevision = persisted.revision || result.workspaceRevision;
                        result.generatedOutputNodeIds = persisted.outputNodeIds;
                        result.generationVerified = true;
                    } else {
                        await waitForAssistantSettled(page, turnDeadline, {
                            requiresGeneration: false,
                            generationRequested: () => workrallyStarted > workrallyBeforeTurn,
                            pendingGenerations: () => pendingWorkrallyRequests.size,
                            generationCompletedAt: () => workrallyCompletedAt,
                        });
                    }
                    const traceDir = path.join(caseDir, `turn-${turn.index}-network`);
                    const traceFiles = await traceFilesSince(traceStart, traceDir);
                    result.traceFiles.push(...traceFiles.map((file) => `turn-${turn.index}-network/${file}`));
                    result.turns.push({ index: turn.index, purpose: turn.purpose, message: turn.message, attachments: turn.attachments.map((item) => item.fileName), elapsedMs: Date.now() - turnStart, status: "completed" });
                } catch (error) {
                    const waitingForHuman = CONFIRMATION_MODE === "human" && await isWaitingForHumanConfirmation(page);
                    result.status = waitingForHuman ? "blocked" : "failed";
                    result.turns.push({ index: turn.index, purpose: turn.purpose, message: turn.message, attachments: turn.attachments.map((item) => item.fileName), elapsedMs: Date.now() - turnStart, status: waitingForHuman ? "paused_for_human" : "failed", error: error instanceof Error ? error.message : String(error) });
                    if (waitingForHuman) updateCaseState(evaluationState, caseDef.id, { executionStatus: "paused_for_human", interventionStatus: "waiting_for_human" }, { type: "human_confirmation_required", detail: turn.purpose });
                    break;
                }
            }
            if (caseDef.pilot.modality === "audio") result.status = "blocked";
        } catch (error) {
            result.status = "failed";
            result.error = error instanceof Error ? error.message : String(error);
        } finally {
            await fs.mkdir(caseDir, { recursive: true });
            result.channelAudit = { deepseekRequests, workrallyRequests, creditRequests, audioBlocked: caseDef.pilot.modality === "audio" };
            const failedRequests = network.filter((item) => item.status >= 400);
            if (creditRequests > 0 || failedRequests.length > 0) {
                result.status = "failed";
                result.error ||= `检测到失败或违规请求：${failedRequests.map((item) => `${item.status} ${item.url}`).join(", ") || "积分渠道请求"}`;
            }
            let evidenceStatus: "complete" | "partial" | "missing" = "missing";
            if (result.canvasId) {
                try {
                    // 先归档并校验本次输出，再允许最终截图；页面在这里之前绝不会被关闭或跳转。
                    const archived = await archiveCanvasSnapshot({ runDir: RUN_DIR, caseId: caseDef.id, canvasId: result.canvasId, cookie: `echodrama_session=${session.value}`, baseUrl: BASE_URL });
                    result.workspaceRevision = archived.canvas.revision || result.workspaceRevision;
                    const hasArchiveErrors = archived.manifest.media.some((item) => item.status === "error");
                    const hasArchivedMedia = archived.manifest.media.some((item) => item.status === "archived");
                    const hasVerifiedGeneratedOutput = !result.generationRequired || archived.manifest.media.some((item) => item.role === "output"
                        && item.status === "archived"
                        && Boolean(item.nodeId && result.generatedOutputNodeIds?.includes(item.nodeId)));
                    if (result.generationRequired && !hasVerifiedGeneratedOutput) {
                        result.status = "failed";
                        result.generationVerified = false;
                        result.error ||= "生成输出未以已归档媒体形式写入证据，拒绝标记为最终完成";
                    }
                    evidenceStatus = hasArchiveErrors || !hasArchivedMedia || !hasVerifiedGeneratedOutput ? "partial" : "complete";
                } catch (archiveError) {
                    result.error ||= `证据归档失败：${archiveError instanceof Error ? archiveError.message : String(archiveError)}`;
                    evidenceStatus = "partial";
                }
            }
            if (page && !page.isClosed()) await captureCaseScreenshot(page, result, caseDir).catch((screenshotError) => {
                result.error ||= `截图归档失败：${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`;
            });
            const pausedForHuman = evaluationState.cases[caseDef.id]?.executionStatus === "paused_for_human";
            const executionStatus = pausedForHuman ? "paused_for_human" : result.status === "completed" ? "completed" : result.status === "blocked" ? "blocked" : "failed";
            updateCaseState(evaluationState, caseDef.id, {
                executionStatus,
                acceptanceStatus: result.status === "completed" ? "needs_review" : result.status === "blocked" ? "limited" : "failed",
                evidenceStatus,
            }, { type: "case_finalized", detail: result.status });
            await writeRunState(RUN_DIR, evaluationState);
            result.finishedAt = new Date().toISOString();
            await fs.writeFile(path.join(caseDir, "result.json"), JSON.stringify(result, null, 2));
            if (page && !page.isClosed()) await page.close().catch(() => undefined);
            results.push(result);
            await fs.writeFile(path.join(RUN_DIR, "progress.json"), JSON.stringify({ runId: RUN_ID, results }, null, 2));
        }
    }
    await context.close();
    await fs.writeFile(path.join(RUN_DIR, "run.json"), JSON.stringify({ runId: RUN_ID, agent: "echo", targetVersion: targetFingerprint.trim(), collection: { id: collection.id, sha256: collection.sha256 }, persistentProfile: PROFILE_DIR, evaluationAccount: session.username, modelRouting: { text: "DeepSeek API via local trace proxy", image: "WorkRally CLI", video: "WorkRally CLI", credit: "forbidden", audio: "blocked: no WorkRally audio adapter" }, results }, null, 2));
    console.log(JSON.stringify({ runId: RUN_ID, runDir: RUN_DIR, completed: results.filter((item) => item.status === "completed").length, blocked: results.filter((item) => item.status === "blocked").length, failed: results.filter((item) => item.status === "failed").length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

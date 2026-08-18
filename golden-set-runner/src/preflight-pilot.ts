import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteThread, newThread, readCanvasAgentConfig, sendTurn } from "./codex-driver";
import { HeadlessCanvasClient } from "./headless-canvas";
import { preparePilotMedia } from "./media-fixtures";
import { readMediaUploadConfig } from "./media-upload-client";
import { loadPilotCollection } from "./pilot-case-loader";
import { assertTargetUnchanged, fingerprintTarget, getAndVerifyAgentWorkspace } from "./target-readonly-guard";
import { discoverModels } from "./workrally-generation";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREFLIGHT_ARCHIVE = path.resolve(HERE, "..", "runs", "preflight-pilot-last.json");

type ProbeResult = { status: "done" | "agent_error" | "timeout" | "blocked" | "skipped"; message?: string; workspacePath?: string };

async function reachable(url: string, init?: RequestInit) {
    try { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) }); return { ok: response.ok, status: response.status }; }
    catch (error) { return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }; }
}

async function lifecycleProbe(url: string, token: string): Promise<ProbeResult> {
    if (!token) return { status: "skipped", message: "canvas-agent token 未配置" };
    const canvasId = `pilot-preflight-${Date.now()}`;
    const client = new HeadlessCanvasClient("content", `pilot-preflight-client-${Date.now()}`, url, token, {
        onHello: () => {}, onToolCall: () => {}, onAgentEvent: () => {}, onToolExecuted: () => {}, onStateChanged: () => {},
    });
    let threadId = "";
    try {
        const before = await fingerprintTarget();
        const workspace = await getAndVerifyAgentWorkspace(url, token, canvasId);
        assertTargetUnchanged(before, await fingerprintTarget());
        client.connect();
        await client.postStatePublic();
        threadId = await newThread(url, token, canvasId);
        await sendTurn(url, token, canvasId, "这是评测生命周期预检。请只回复“已收到”，不要调用任何画布工具。", threadId);
        const result = await client.waitForAgentDone(15_000);
        return { ...result, workspacePath: workspace.workspacePath };
    } catch (error) {
        return { status: "blocked", message: error instanceof Error ? error.message : String(error) };
    } finally {
        if (threadId) await deleteThread(url, token, canvasId, threadId);
        await client.close();
    }
}

async function main() {
    const collection = await loadPilotCollection();
    const config = readCanvasAgentConfig();
    const mediaUpload = readMediaUploadConfig();
    const [agent, bridge, models] = await Promise.all([
        reachable(`${config.url}/health`, { headers: { "x-canvas-agent-token": config.token } }),
        reachable("http://127.0.0.1:19999/models"),
        discoverModels(),
    ]);
    const target = await fingerprintTarget().then((fingerprint) => ({ status: "verified" as const, ...fingerprint })).catch((error) => ({ status: "blocked" as const, message: error instanceof Error ? error.message : String(error) }));
    const lifecycle = agent.ok && target.status === "verified" ? await lifecycleProbe(config.url, config.token) : { status: "skipped" as const, message: "基础服务或目标只读指纹不可用" };
    const resourceFailures: Array<{ caseId: string; error: string }> = [];
    let inputCount = 0;
    if (mediaUpload) {
        for (const caseDef of collection.cases) {
            try { inputCount += (await preparePilotMedia(caseDef)).inputMedia.length; }
            catch (error) { resourceFailures.push({ caseId: caseDef.id, error: error instanceof Error ? error.message : String(error) }); }
        }
    }
    const report = {
        checkedAt: new Date().toISOString(),
        collection: { id: collection.id, version: collection.version, cases: collection.cases.length, sha256: collection.sha256 },
        canvasAgent: { url: config.url, configuredToken: Boolean(config.token), ...agent },
        targetProtection: target,
        lifecycle,
        responsesBridge: bridge,
        resources: { verifiedInputs: inputCount, failures: resourceFailures },
        mediaUpload: { configured: Boolean(mediaUpload), baseUrl: mediaUpload?.baseUrl || null, note: mediaUpload ? "真实视频将通过 /api/media/upload 预接入" : "缺少 PILOT_MEDIA_BASE_URL/PILOT_MEDIA_COOKIE，视频 Case 不会写入占位节点" },
        workrally: { imageModels: models.image, videoModels: models.video, audioProvider: "unavailable: runner will preserve a structured failure instead of image fallback" },
        scoring: "disabled",
        readyForBatch: agent.ok && bridge.ok && target.status === "verified" && lifecycle.status === "done" && Boolean(mediaUpload) && resourceFailures.length === 0,
    };
    await fs.mkdir(path.dirname(PREFLIGHT_ARCHIVE), { recursive: true });
    await fs.writeFile(PREFLIGHT_ARCHIVE, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ ...report, archiveFile: PREFLIGHT_ARCHIVE }, null, 2));
    if (!report.readyForBatch) process.exitCode = 2;
}
void main();

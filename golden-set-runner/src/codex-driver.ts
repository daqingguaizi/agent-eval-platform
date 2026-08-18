// codex 驱动：读 ~/.infinite-canvas/canvas-agent.json 拿 url/token，
// 为每条用例开独立 thread，逐轮 POST /agent/codex/turn 驱动对话。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CanvasAgentConfig = { url: string; token: string; canvases?: Record<string, { workspacePath?: string; activeThreadId?: string }> };

// 读 canvas-agent 配置；失败时返回空（调用方给默认值）。
export function readCanvasAgentConfig(): { url: string; token: string } {
    const file = process.env.CANVAS_AGENT_CONFIG_FILE || path.join(os.homedir(), ".infinite-canvas", "canvas-agent.json");
    try {
        const raw = fs.readFileSync(file, "utf8");
        const config = JSON.parse(raw) as CanvasAgentConfig;
        return { url: config.url || "http://127.0.0.1:17371", token: config.token || "" };
    } catch {
        return { url: "http://127.0.0.1:17371", token: "" };
    }
}

async function jsonRequest(url: string, init: RequestInit) {
    const res = await fetch(url, init);
    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        // 空 body
    }
    if (!res.ok) {
        const msg = (data as { error?: string })?.error || `HTTP ${res.status}`;
        throw new Error(`${url} -> ${msg}`);
    }
    return data;
}

// 为用例开独立 thread。canvasId 用于在 config.json 里隔离 workspace。
export async function newThread(url: string, token: string, canvasId: string) {
    const data = await jsonRequest(`${url}/agent/codex/threads/new?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-canvas-agent-token": token },
        body: JSON.stringify({ canvasId }),
    });
    const thread = (data as { thread?: { id?: string } })?.thread;
    const threadId = thread?.id || "";
    if (!threadId) throw new Error(`开 thread 失败：${JSON.stringify(data).slice(0, 240)}`);
    return threadId;
}

export type CanvasAgentAttachment = { name: string; type: string; dataUrl: string };

// 逐轮驱动。附件字段与产品 canvas-local-agent-panel 的 Codex 请求保持一致。
export async function sendTurn(url: string, token: string, canvasId: string, prompt: string, threadId?: string, attachments: CanvasAgentAttachment[] = []) {
    const body: Record<string, unknown> = { prompt, canvasId };
    if (threadId) body.threadId = threadId;
    if (attachments.length) body.attachments = attachments;
    const data = await jsonRequest(`${url}/agent/codex/turn?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-canvas-agent-token": token },
        body: JSON.stringify(body),
    });
    return (data as { threadId?: string })?.threadId || threadId || "";
}

export async function deleteThread(url: string, token: string, canvasId: string, threadId: string) {
    try {
        await jsonRequest(`${url}/agent/codex/threads/${encodeURIComponent(threadId)}/delete?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-canvas-agent-token": token },
            body: JSON.stringify({ canvasId }),
        });
    } catch {
        // 删除失败不阻塞（归档线程）
    }
}

// 计算 AGENT_PROMPT 的 sha（动态 import canvas-agent dist/config.js 取真实值留证）
let cachedPrompt: string | null | undefined;

export async function agentPrompt(): Promise<string | null> {
    if (cachedPrompt !== undefined) return cachedPrompt;
    try {
        const { fileURLToPath, pathToFileURL } = await import("node:url");
        const here = path.dirname(fileURLToPath(import.meta.url));
        // 运行中的 Agent 可来自只读目标源码的隔离构建副本，优先读取其真实 dist。
        const distRoot = process.env.CANVAS_AGENT_DIST_ROOT || path.resolve(here, "..", "..", "..", "products", "echo-infinite-canvas-main", "canvas-agent", "dist");
        const dist = path.join(distRoot, "config.js");
        const mod = await import(pathToFileURL(dist).href);
        const value = (mod as { AGENT_PROMPT?: string })?.AGENT_PROMPT || "";
        cachedPrompt = value || null;
        return cachedPrompt;
    } catch {
        cachedPrompt = null;
        return cachedPrompt;
    }
}

export async function agentPromptSha(): Promise<string> {
    const prompt = await agentPrompt();
    if (!prompt) return "unknown";
    const { createHash } = await import("node:crypto");
    return createHash("sha1").update(prompt).digest("hex").slice(0, 12);
}

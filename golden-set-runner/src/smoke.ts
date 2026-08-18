// 最小闭环冒烟：验证 DeepSeek 驱动 codex -> MCP -> canvas-agent -> 无头客户端执行 全链路。
// 发一句「建一个文本节点写 hello」，断言：
//   1. 收到 mcp_tool_call（模型真的发出了工具调用）
//   2. 收到 tool_call（canvas-agent 派发给客户端）
//   3. 画布真的多出一个 text 节点（执行层真跑了）
//   4. 收到 agent_done（本轮正常结束）
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HeadlessCanvasClient, type PendingToolCall } from "./headless-canvas";
import { readCanvasAgentConfig, newThread, sendTurn } from "./codex-driver";
import type { RawAgentEvent } from "./trace";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_HOME = path.resolve(HERE, "..", "codex-home");

async function main() {
    const { url, token } = readCanvasAgentConfig();
    if (!token) {
        console.error("无法读取 token，请先启动 canvas-agent。");
        process.exit(1);
    }

    // 健康检查
    try {
        const health = await fetch(`${url}/health`);
        const body = (await health.json()) as { ok?: boolean; hasCanvas?: boolean };
        console.log(`canvas-agent: ${url} ok=${body.ok} hasCanvas=${body.hasCanvas}`);
    } catch (error) {
        console.error(`无法连接 canvas-agent（${url}）。请确认已用以下命令启动：`);
        console.error(`  cd canvas-agent && CODEX_HOME=${CODEX_HOME} DEEPSEEK_API_KEY=<你的key> npm run dev`);
        process.exit(1);
    }

    const clientId = `smoke-${Date.now()}`;
    const events: RawAgentEvent[] = [];
    let sawMcpToolCall = false;
    let sawToolCall = false;
    let toolCalls: PendingToolCall[] = [];

    const client = new HeadlessCanvasClient("content", clientId, url, token, {
        onHello: () => {},
        onToolCall: (payload) => {
            sawToolCall = true;
            toolCalls.push(payload);
        },
        onAgentEvent: () => {},
        onToolExecuted: () => {},
        onStateChanged: () => {},
    });
    client.onAgentEvent = (type: string, data: unknown) => {
        events.push({ type, data, at: Date.now() });
        if (type === "agent_event") {
            const d = data as { type?: string; item?: { type?: string } };
            if (d.item?.type === "mcp_tool_call" || d.item?.type === "mcpToolCall") sawMcpToolCall = true;
        }
    };
    client.connect();

    const canvasId = `smoke-${Date.now()}`;
    const threadId = await newThread(url, token, canvasId);
    console.log(`thread: ${threadId}`);

    // 等 hello + 首次 state
    await new Promise((r) => setTimeout(r, 1000));

    await sendTurn(url, token, canvasId, "请创建一个文本节点，内容写 hello", threadId);
    console.log("turn 已发送，等待 agent_done ...");

    const done = await client.waitForAgentDone(Number(process.env.SMOKE_TIMEOUT_MS || 120000));
    await new Promise((r) => setTimeout(r, 500));

    const snapshot = client.getSnapshot();
    const textNodes = snapshot.nodes.filter((n) => n.type === "text");
    const allTools = events.filter((e) => e.type === "agent_event").map((e) => (e.data as { type?: string })?.type);

    console.log("\n=== 事件类型统计 ===");
    const counts = new Map<string, number>();
    for (const ev of events) counts.set(ev.type, (counts.get(ev.type) || 0) + 1);
    for (const [type, n] of counts) console.log(`  ${type}: ${n}`);

    console.log("\n=== codex 日志消息（去 otel span 前缀 + 去重） ===");
    const seen = new Map<string, number>();
    for (const ev of events) {
        if (ev.type !== "agent_log") continue;
        const raw = String((ev.data as { text?: unknown })?.text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
        for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            // codex 的 tracing 行形如<时间> <级别> <span>{...}: <module>: <消息>
            // 取最后一个 "}: " 之后的部分，否则取去掉时间戳的部分
            const idx = line.lastIndexOf("}: ");
            const msg = (idx >= 0 ? line.slice(idx + 3) : line.replace(/^\S+Z\s+/, "")).trim();
            if (!msg) continue;
            const key = msg.slice(0, 90);
            seen.set(key, (seen.get(key) || 0) + 1);
        }
    }
    for (const [msg, n] of [...seen.entries()].slice(0, 45)) console.log(`  x${n} ${msg}`);

    console.log("\n=== agent_error / agent_event ===");
    for (const ev of events) {
        if (ev.type === "agent_error") console.log(`[ERROR] ${String((ev.data as { message?: unknown })?.message ?? "")}`);
        else if (ev.type === "agent_event") console.log(`[event] ${String((ev.data as { type?: unknown })?.type ?? "")}`);
    }

    console.log("\n=== 冒烟结果 ===");
    console.log(`agent_done: ${done}`);
    console.log(`收到 mcp_tool_call: ${sawMcpToolCall}`);
    console.log(`收到 tool_call(客户端): ${sawToolCall}`);
    console.log(`tool_call 数: ${toolCalls.length}`);
    console.log(`画布 text 节点数: ${textNodes.length}`);
    console.log(`第一个 text 节点 content: ${textNodes[0]?.metadata?.content}`);
    console.log(`事件序列: ${[...new Set(allTools)].join(" -> ")}`);

    const pass =
        sawMcpToolCall &&
        sawToolCall &&
        textNodes.length >= 1 &&
        String(textNodes[0]?.metadata?.content || "").includes("hello") &&
        done;
    console.log(`\n${pass ? "SMOKE_PASS" : "SMOKE_FAIL"}`);

    await client.close();
    process.exit(pass ? 0 : 1);
}

main().catch((error) => {
    console.error("冒烟异常：", error);
    process.exit(1);
});

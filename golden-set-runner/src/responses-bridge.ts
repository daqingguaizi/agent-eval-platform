// Responses -> Chat 适配网关：
// 把 codex 0.139 发的 OpenAI Responses API 请求转成 DeepSeek 的 chat/completions，
// 再把 DeepSeek 响应转回 Responses 格式。保留全部 MCP 工具调用。
//
// 用法：node responses-bridge.ts  （默认 19999 端口）
// 配置：DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL(默认 https://api.deepseek.com/v1)、PORT
import http from "node:http";

const PORT = Number(process.env.PORT || 19999);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

if (!DEEPSEEK_KEY) {
    console.error("缺少 DEEPSEEK_API_KEY 环境变量");
    process.exit(1);
}

// ---- Responses -> Chat 消息转换 ----

// 只在首次请求时打印工具清单，用于确认 codex 暴露给模型的工具集
let loggedToolNames = false;
let reqSeq = 0;

type ChatMessage = Record<string, unknown>;

function toChatMessages(input: unknown): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (typeof input === "string") {
        messages.push({ role: "user", content: input });
        return messages;
    }
    if (!Array.isArray(input)) {
        messages.push({ role: "user", content: String(input ?? "") });
        return messages;
    }
    for (const item of input) {
        if (typeof item === "string") {
            messages.push({ role: "user", content: item });
            continue;
        }
        const it = item as Record<string, unknown>;
        if (typeof it !== "object" || it === null) continue;
        const type = String(it.type || "message");
        if (type === "message") {
            // DeepSeek 不支持 developer role，映射为 system
            const roleRaw = String(it.role || "user");
            const role = roleRaw === "developer" ? "system" : roleRaw;
            messages.push({ role, content: responseContentToString(it.content) });
        } else if (type === "function_call") {
            messages.push({
                role: "assistant",
                content: it.content ? responseContentToString(it.content) : "",
                tool_calls: [
                    {
                        id: String(it.call_id || it.id || ""),
                        type: "function",
                        function: { name: String(it.name || ""), arguments: typeof it.arguments === "string" ? it.arguments : JSON.stringify(it.arguments ?? {}) },
                    },
                ],
            });
        } else if (type === "function_call_output") {
            messages.push({ role: "tool", tool_call_id: String(it.call_id || it.id || ""), content: responseContentToString(it.output ?? it.content) });
        }
    }
    return mergeAssistantMessages(messages);
}

function responseContentToString(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => {
                if (typeof c === "string") return c;
                const cc = c as Record<string, unknown>;
                if (cc && (cc.type === "output_text" || cc.type === "input_text")) return String(cc.text ?? "");
                return "";
            })
            .join("");
    }
    return String(content);
}

// 合并相邻 assistant 消息（codex 可能把多条 tool_calls 拆成多条 assistant）
function mergeAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = [];
    for (const msg of messages) {
        const last = merged[merged.length - 1];
        if (last && last.role === "assistant" && msg.role === "assistant" && (Array.isArray(last.tool_calls) || Array.isArray(msg.tool_calls))) {
            last.tool_calls = [...(Array.isArray(last.tool_calls) ? last.tool_calls : []), ...(Array.isArray(msg.tool_calls) ? msg.tool_calls : [])];
            if (msg.content) last.content = String(last.content || "") + String(msg.content || "");
            continue;
        }
        merged.push({ ...msg });
    }
    return merged;
}

// namespace 工具展开后的命名方式。codex 会校验回传的 function_call 名字，
// 名字不对会返回 "unsupported call:<name>"。用环境变量切换以便实测确认。
const NS_MODE = process.env.BRIDGE_NS_MODE || "bare";
function namespacedName(ns: string, tool: string) {
    if (!ns) return tool;
    if (NS_MODE === "dunder") return `${ns}__${tool}`;
    if (NS_MODE === "dot") return `${ns}.${tool}`;
    return tool;
}

// 建立「模型看到的工具名 -> 所属 namespace」映射。
// codex 的 namespace 工具在回传 function_call 时需要带上 namespace 字段，
// 否则会被判为 "unsupported call"。
function buildNamespaceMap(tools: unknown): Record<string, string> {
    const map: Record<string, string> = {};
    if (!Array.isArray(tools)) return map;
    for (const raw of tools) {
        const t = raw as Record<string, unknown>;
        if (String(t?.type) !== "namespace") continue;
        const ns = String(t.name || "");
        for (const sub of Array.isArray(t.tools) ? t.tools : []) {
            const subName = String((sub as Record<string, unknown>)?.name || "");
            if (subName) map[namespacedName(ns, subName)] = ns;
        }
    }
    return map;
}

// codex 0.139 的 tools 数组有多种形态：
//   type=function   普通函数工具
//   type=namespace  工具组，真实工具嵌套在 tools 里（MCP 工具就走这里，
//                   如 mcp__infinite_canvas 下挂 23 个 canvas_* 工具）。
//                   必须展开成 <namespace>__<tool>，否则模型拿不到画布工具，
//                   直接调 namespace 名会被 codex 拒为 "unsupported call"。
//   type=custom     freeform grammar 工具（apply_patch），Chat Completions 无法表达
//   type=web_search 内置检索，无 name
// 后两者跳过：它们不属于画布能力，跳过可避免污染判据。
function toChatTools(tools: unknown) {
    if (!Array.isArray(tools)) return undefined;
    const out: Array<Record<string, unknown>> = [];
    const pushFunction = (t: Record<string, unknown>, name: string) => {
        const fn = t.function as Record<string, unknown> | undefined;
        const description = fn?.description ?? t.description;
        const parameters = fn?.parameters ?? t.parameters;
        out.push({ type: "function", function: { name, description: String(description ?? ""), parameters: parameters ?? { type: "object", properties: {} } } });
    };
    for (const raw of tools) {
        const t = raw as Record<string, unknown>;
        if (!t || typeof t !== "object") continue;
        const type = String(t.type || "function");
        if (type === "namespace") {
            const nsName = String(t.name || "");
            const nested = Array.isArray(t.tools) ? t.tools : [];
            for (const sub of nested) {
                const s = sub as Record<string, unknown>;
                const subName = String(s?.name || "");
                if (!subName) continue;
                pushFunction(s, namespacedName(nsName, subName));
            }
            continue;
        }
        if (type === "custom" || type === "web_search") continue;
        const fn = t.function as Record<string, unknown> | undefined;
        const name = String(fn?.name ?? t.name ?? "");
        if (!name) continue;
        pushFunction(t, name);
    }
    return out;
}

// ---- Chat -> Responses ----

function chatResultToResponses(chatData: Record<string, unknown>, requestId: string) {
    const choices = (chatData.choices as Array<{ message?: Record<string, unknown> }>) || [];
    const message = choices[0]?.message || {};
    const output: Array<Record<string, unknown>> = [];
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const tc of toolCalls) {
        const t = tc as { id?: string; function?: { name?: string; arguments?: unknown } };
        output.push({
            type: "function_call",
            id: t.id || `call_${Math.random().toString(36).slice(2, 8)}`,
            call_id: t.id || "",
            name: t.function?.name || "",
            arguments: typeof t.function?.arguments === "string" ? t.function.arguments : JSON.stringify(t.function?.arguments ?? {}),
            status: "completed",
        });
    }
    if (message.content) {
        output.push({
            type: "message",
            id: `msg_${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: String(message.content) }],
        });
    }
    const usage = (chatData.usage as Record<string, number>) || {};
    return {
        id: requestId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model: MODEL,
        status: "completed",
        output,
        usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
    };
}

function emit(res: http.ServerResponse, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// 流式：把 DeepSeek 的 SSE 转发成 codex 期望的 Responses SSE。
// 关键：codex 只在收到 response.output_item.done 时才把 item 落地并派发工具调用，
// 光有 delta 事件会导致 turn.completed 里 items 为空、工具永不执行。
async function handleStream(req: http.IncomingMessage, res: http.ServerResponse, chatBody: Record<string, unknown>, requestId: string, nsMap: Record<string, string> = {}) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // 累积的输出项：函数调用按 DeepSeek 的 index 归并，文本单独一项
    const toolCalls = new Map<number, { id: string; name: string; args: string; added: boolean }>();
    let text = "";
    let textItemAdded = false;
    const msgId = `msg_${Math.random().toString(36).slice(2, 10)}`;
    let usage: Record<string, number> = {};
    let finished = false;

    const finalize = (status: "completed" | "failed", error?: unknown) => {
        if (finished) return;
        finished = true;
        const output: Array<Record<string, unknown>> = [];
        let outputIndex = 0;
        for (const tc of toolCalls.values()) {
            const item: Record<string, unknown> = { type: "function_call", id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args || "{}", status: "completed" };
            if (nsMap[tc.name]) item.namespace = nsMap[tc.name];
            output.push(item);
            emit(res, "response.function_call_arguments.done", { type: "response.function_call_arguments.done", item_id: tc.id, output_index: outputIndex, arguments: item.arguments });
            emit(res, "response.output_item.done", { type: "response.output_item.done", output_index: outputIndex, item });
            outputIndex += 1;
        }
        if (text) {
            const item = { type: "message", id: msgId, role: "assistant", status: "completed", content: [{ type: "output_text", text }] };
            output.push(item);
            emit(res, "response.output_item.done", { type: "response.output_item.done", output_index: outputIndex, item });
            outputIndex += 1;
        }
        const response: Record<string, unknown> = {
            id: requestId,
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            model: MODEL,
            status,
            output,
            usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 },
        };
        if (error) response.error = error;
        emit(res, status === "completed" ? "response.completed" : "response.failed", { type: status === "completed" ? "response.completed" : "response.failed", response });
        res.end();
        console.log(`[${requestId}] <- stream ${status} tool_calls=${[...toolCalls.values()].map((t) => t.name).join(",") || "-"} text=${text.length}字 tokens=${usage.total_tokens ?? 0}`);
    };

    try {
        const upstreamRes = await fetchWithRetry(`${DEEPSEEK_BASE}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${DEEPSEEK_KEY}` },
            body: JSON.stringify({ ...chatBody, stream: true, stream_options: { include_usage: true } }),
        });
        if (!upstreamRes.ok || !upstreamRes.body) {
            const errText = await upstreamRes.text();
            console.error(`[${requestId}] DeepSeek 非 200:`, upstreamRes.status, errText.slice(0, 300));
            finalize("failed", { code: "upstream", message: errText.slice(0, 200) });
            return;
        }
        emit(res, "response.created", { type: "response.created", response: { id: requestId, object: "response", created_at: Math.floor(Date.now() / 1000), model: MODEL, status: "in_progress", output: [] } });

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") {
                    finalize("completed");
                    return;
                }
                let json: Record<string, unknown>;
                try {
                    json = JSON.parse(payload);
                } catch {
                    continue;
                }
                if (json.usage && typeof json.usage === "object") usage = json.usage as Record<string, number>;
                const choices = (json.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>) || [];
                const delta = choices[0]?.delta || {};

                const deltaToolCalls = delta.tool_calls;
                if (Array.isArray(deltaToolCalls)) {
                    for (const raw of deltaToolCalls) {
                        const tc = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
                        const idx = typeof tc.index === "number" ? tc.index : 0;
                        let entry = toolCalls.get(idx);
                        if (!entry) {
                            entry = { id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: "", args: "", added: false };
                            toolCalls.set(idx, entry);
                        }
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name += tc.function.name;
                        if (entry.name && !entry.added) {
                            entry.added = true;
                            const added: Record<string, unknown> = { type: "function_call", id: entry.id, call_id: entry.id, name: entry.name, arguments: "", status: "in_progress" };
                            if (nsMap[entry.name]) added.namespace = nsMap[entry.name];
                            emit(res, "response.output_item.added", { type: "response.output_item.added", output_index: idx, item: added });
                        }
                        if (tc.function?.arguments) {
                            entry.args += tc.function.arguments;
                            emit(res, "response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: entry.id, output_index: idx, delta: tc.function.arguments });
                        }
                    }
                }

                const deltaContent = delta.content;
                if (typeof deltaContent === "string" && deltaContent) {
                    if (!textItemAdded) {
                        textItemAdded = true;
                        emit(res, "response.output_item.added", { type: "response.output_item.added", output_index: toolCalls.size, item: { type: "message", id: msgId, role: "assistant", status: "in_progress", content: [] } });
                    }
                    text += deltaContent;
                    emit(res, "response.output_text.delta", { type: "response.output_text.delta", item_id: msgId, output_index: toolCalls.size, delta: deltaContent });
                }
            }
        }
        finalize("completed");
    } catch (error) {
        console.error(`[${requestId}] stream error:`, error);
        finalize("failed", { message: String(error) });
    }
}

// 重试：DeepSeek 服务端偶发 503 busy，指数退避重试
async function fetchWithRetry(url: string, init: RequestInit, retries = 4): Promise<Response> {
    let last: Response | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
        const res = await fetch(url, init);
        if (res.status !== 503) return res;
        last = res;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    return last as Response;
}

async function handleNonStream(req: http.IncomingMessage, res: http.ServerResponse, chatBody: Record<string, unknown>, requestId: string) {
    try {
        const upstreamRes = await fetchWithRetry(`${DEEPSEEK_BASE}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${DEEPSEEK_KEY}` },
            body: JSON.stringify({ ...chatBody, stream: false }),
        });
        const data = await upstreamRes.text();
        if (!upstreamRes.ok) {
            console.error("DeepSeek 非 200:", upstreamRes.status, data.slice(0, 300));
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: `upstream ${upstreamRes.status}: ${data.slice(0, 200)}` } }));
            return;
        }
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(data);
        } catch {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: "DeepSeek 返回非 JSON" } }));
            return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        const converted = chatResultToResponses(parsed, requestId);
        console.log(`[${requestId}] <- nonstream completed output_items=${(converted.output as unknown[]).length}`);
        res.end(JSON.stringify(converted));
    } catch (error) {
        console.error("nonstream error:", error);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(error) } }));
    }
}

const server = http.createServer((req, res) => {    // codex 启动时探测模型列表（GET /models 或 GET /v1/models）
    if (req.method === "GET" && (req.url?.endsWith("/models") || req.url?.includes("/models"))) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "deepseek" }] }));
        return;
    }
    // codex 可能请求 /responses 或 /v1/responses（取决于 base_url 配置）
    if (req.method !== "POST" || !(req.url?.includes("/responses") || req.url?.endsWith("/responses"))) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(body);
        } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: "invalid json" } }));
            return;
        }
        const requestId = String(parsed.id || `req_${Math.random().toString(36).slice(2, 10)}`);
        const stream = Boolean(parsed.stream);
        const messages = toChatMessages(parsed.input);
        const tools = toChatTools(parsed.tools);
        const chatBody: Record<string, unknown> = { model: MODEL, messages, stream, ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}) };
        if (typeof parsed.temperature === "number") chatBody.temperature = parsed.temperature;
        if (typeof parsed.max_output_tokens === "number") chatBody.max_tokens = parsed.max_output_tokens;
        console.log(`[${requestId}] -> ${req.url} stream=${stream} messages=${messages.length} tools=${tools?.length ?? 0}`);
        // 调试：把每次请求的 chatBody 落盘，便于查看工具返回内容与上下文演化
        if (process.env.BRIDGE_DUMP_DIR) {
            reqSeq += 1;
            const dir = process.env.BRIDGE_DUMP_DIR;
            const seq = String(reqSeq).padStart(3, "0");
            void import("node:fs/promises").then(async (fsp) => {
                await fsp.writeFile(`${dir}/req-${seq}.json`, JSON.stringify(chatBody, null, 2));
                await fsp.writeFile(`${dir}/raw-${seq}.json`, JSON.stringify(parsed, null, 2));
            });
        }
        if (!loggedToolNames && tools?.length) {
            loggedToolNames = true;
            console.log(`[tools] ${tools.map((t) => (t as { function: { name: string } }).function.name).join(", ")}`);
            // 完整 schema 落盘，便于确认 codex 暴露给模型的工具形态（尤其 MCP 网关工具）
            if (process.env.BRIDGE_DUMP_TOOLS) {
                void import("node:fs/promises").then((fsp) => fsp.writeFile(process.env.BRIDGE_DUMP_TOOLS as string, JSON.stringify(tools, null, 2)));
            }
        }
        if (stream) void handleStream(req, res, chatBody, requestId, buildNamespaceMap(parsed.tools));
        else void handleNonStream(req, res, chatBody, requestId);
    });
});

server.listen(PORT, () => {
    console.log(`Responses->Chat bridge listening on ${PORT}`);
    console.log(`DeepSeek base: ${DEEPSEEK_BASE}, model: ${MODEL}`);
});

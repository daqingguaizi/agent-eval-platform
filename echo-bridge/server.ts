/**
 * Echo Bridge — 浏览器 Harness
 *
 * 评测平台通过 POST /execute 提交执行请求。
 * Bridge 用 Playwright 打开画布页面（带 ?echoBridge=true 参数），
 * 页面暴露 window.__echoBridge API 供 Bridge 调用。
 * Bridge 通过该 API 注入消息、等待 Echo 完成、采集 Trace。
 *
 * 前置条件：
 *   画布前端需支持 ?echoBridge=true 参数（在 canvas 页面注入 Bridge API）。
 *
 * 环境变量：
 *   ECHO_CANVAS_URL  - 画布页面地址（默认 http://localhost:3000/canvas）
 *   ECHO_EVAL_SECRET - HMAC 签名密钥
 *   BRIDGE_PORT       - Bridge 端口（默认 17372）
 *   EVAL_CALLBACK_URL - 评测平台回调地址（默认 http://localhost:3100）
 *   BRIDGE_MAX_CONCURRENT - 最大并发执行数（默认 1，避免资源竞争）
 */

import http from "node:http";
import { createHmac } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";

const CANVAS_URL = process.env.ECHO_CANVAS_URL ?? "http://localhost:3000/canvas";
const EVAL_SECRET = process.env.ECHO_EVAL_SECRET ?? "echo-bridge-dev-secret";
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 17372);
const EVAL_CALLBACK_URL = process.env.EVAL_CALLBACK_URL ?? "http://localhost:3100";
const MAX_CONCURRENT = Number(process.env.BRIDGE_MAX_CONCURRENT ?? 1);

function log(level: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const prefix = `[bridge ${level}]`;
  if (data) console.log(`${ts} ${prefix} ${msg}`, JSON.stringify(data).slice(0, 500));
  else console.log(`${ts} ${prefix} ${msg}`);
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
    log("info", "浏览器已启动");
  }
  return browser;
}

// ============================================================
// 并发队列：确保同时最多 MAX_CONCURRENT 个 trial 在执行
// ============================================================
let runningCount = 0;
const pendingQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (runningCount < MAX_CONCURRENT) {
    runningCount++;
    return;
  }
  log("info", `并发槽位已满 (${runningCount}/${MAX_CONCURRENT})，进入队列等待...`);
  await new Promise<void>((resolve) => {
    pendingQueue.push(resolve);
  });
}

function releaseSlot(): void {
  runningCount--;
  const next = pendingQueue.shift();
  if (next) {
    runningCount++;
    next();
    log("info", `队列中的下一个任务开始执行 (${runningCount}/${MAX_CONCURRENT})`);
  }
}

// ============================================================
// 执行处理
// ============================================================
async function handleExecute(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    let request: Record<string, unknown>;
    try { request = JSON.parse(body); } catch {
      res.writeHead(400).end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    const trialId = request.trialId as string;
    const runId = request.runId as string;
    const caseId = request.caseId as string;
    const agentId = request.agentId as string;
    const evalCase = request.evalCase as { input?: { message?: string }; precondition?: { canvasType?: string } } | undefined;
    const userMessage = evalCase?.input?.message ?? "";
    const callbackPath = (request.callbackPath as string) ?? "/api/executions/callback";

    if (!trialId || !runId || !caseId) {
      res.writeHead(400).end(JSON.stringify({ error: "缺少必填字段" }));
      return;
    }

    // 立即返回，异步执行
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sessionId: `echo-bridge-${trialId}` }));

    // 获取并发槽位
    await acquireSlot();

    let page: Page | null = null;
    try {
      log("info", `开始执行 trialId=${trialId} caseId=${caseId} (并发: ${runningCount}/${MAX_CONCURRENT})`);

      const br = await getBrowser();
      const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
      page = await ctx.newPage();

      // 打开画布页面（带 bridge 参数）
      const targetUrl = `${CANVAS_URL}?echoBridge=true`;
      log("info", `打开页面: ${targetUrl}`);

      try {
        // 使用 domcontentloaded 而非 load，因为画布是 SPA，domcontentloaded 更快
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
        log("info", `页面 DOM 加载完成 trialId=${trialId}`);
      } catch (err) {
        log("warn", `页面加载超时 trialId=${trialId}，检查页面是否部分可用...`);
        // 即使超时，检查页面是否已有内容
        try {
          const hasContent = await page.evaluate(() => document.body?.children.length ?? 0);
          if (hasContent === 0) throw new Error("页面完全空白，无法继续");
          log("info", `页面部分加载（${hasContent} 个子元素），继续尝试...`);
        } catch {
          throw new Error(`画布页面无法加载: ${targetUrl}`);
        }
      }

      // 等待页面充分渲染（Next.js SPA 需要额外时间水合）
      await page.waitForTimeout(3000);

      // 等待 Bridge API 就绪（最多 60s）
      try {
        await page.waitForFunction(
          () => !!(window as unknown as Record<string, unknown>).__echoBridge,
          { timeout: 60000 }
        );
        log("info", `Bridge API 就绪 trialId=${trialId}`);
      } catch {
        // 检查是否 CanvasAssistantPanel 未挂载
        const hasPanel = await page.evaluate(() => {
          return !!(window as unknown as Record<string, unknown>).__echoBridgeSubmit;
        });
        if (!hasPanel) {
          throw new Error("Bridge API 未就绪：CanvasAssistantPanel 未挂载或 Echo 助手面板未打开");
        }
        // __echoBridgeSubmit 有但 __echoBridge 没有？可能是 EchoBridgeWrapper 未挂载
        // 手动注入
        log("warn", "__echoBridge 未找到，尝试直接使用 __echoBridgeSubmit");
        await page.evaluate(() => {
          const submit = (window as unknown as Record<string, unknown>).__echoBridgeSubmit as {
            sendMessage: (t: string) => Promise<void>;
            isRunning: () => boolean;
            getMessages: () => unknown[];
            getCanvasState: () => unknown;
          } | undefined;
          if (submit) {
            (window as unknown as Record<string, unknown>).__echoBridge = {
              submit: async (text: string) => {
                const start = Date.now();
                await submit.sendMessage(text);
                const maxWait = 120000;
                const deadline = Date.now() + maxWait;
                while (Date.now() < deadline) {
                  if (!submit.isRunning()) break;
                  await new Promise((r) => setTimeout(r, 500));
                }
                const msgs = submit.getMessages();
                return {
                  messages: msgs,
                  model: "echo-online",
                  loopStep: 1,
                  snapshotAfter: submit.getCanvasState(),
                  startTime: start,
                  durationMs: Date.now() - start,
                };
              },
              getState: () => submit.getCanvasState(),
              isReady: async () => !submit.isRunning(),
            };
          }
        });
      }

      // 获取初始画布快照
      const snapshotBefore = await page.evaluate(() => {
        const bridge = (window as unknown as Record<string, unknown>).__echoBridge as { getState?: () => unknown } | undefined;
        return bridge?.getState?.() ?? null;
      });
      log("info", `初始快照: ${snapshotBefore ? "已获取" : "未获取"}`);

      // 注入消息并等待 Echo 完成
      const result = await page.evaluate(
        async ({ msg }: { msg: string }) => {
          const bridge = (window as unknown as Record<string, unknown>).__echoBridge as {
            submit: (text: string) => Promise<{
              messages: unknown[];
              model?: string;
              loopStep: number;
              snapshotAfter: unknown;
              usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
              startTime: number;
              durationMs: number;
            }>;
          } | undefined;
          if (!bridge?.submit) throw new Error("Bridge submit API 不可用");
          return bridge.submit(msg);
        },
        { msg: userMessage }
      );

      const durationMs = (result as Record<string, unknown>).durationMs as number ?? 0;

      // 构建 rawTrace
      const rawTrace = {
        protocolVersion: "v1",
        traceId: `echo-bridge-${trialId}`,
        sessionId: `echo-bridge-${trialId}`,
        turnId: `turn-${trialId}`,
        messages: (result as Record<string, unknown>).messages ?? [],
        snapshotBefore,
        snapshotAfter: (result as Record<string, unknown>).snapshotAfter ?? null,
        model: (result as Record<string, unknown>).model ?? undefined,
        usage: (result as Record<string, unknown>).usage ?? {},
        loopStep: (result as Record<string, unknown>).loopStep ?? 0,
        startTime: (result as Record<string, unknown>).startTime ?? Date.now(),
        durationMs,
      };

      // 回调评测平台
      const envelope = {
        protocolVersion: "v1",
        eventKey: `echo-bridge:${trialId}:${rawTrace.loopStep}:${rawTrace.durationMs}`,
        runId,
        trialId,
        caseId,
        agentId,
        rawTrace,
        cleanup: { status: "not_required" },
        timestamp: Date.now(),
      };

      const cbBody = JSON.stringify(envelope);
      const ts = String(Date.now());
      const signature = createHmac("sha256", EVAL_SECRET).update(`${ts}.${cbBody}`).digest("hex");

      const cbUrl = `${EVAL_CALLBACK_URL}${callbackPath}`;
      log("info", `回调: ${cbUrl}`);
      const cbResp = await fetch(cbUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eval-timestamp": ts,
          "x-eval-signature": signature,
        },
        body: cbBody,
      });

      if (!cbResp.ok) {
        const errText = await cbResp.text();
        log("error", `回调失败 HTTP ${cbResp.status}: ${errText.slice(0, 300)}`);
      } else {
        log("info", `回调成功 trialId=${trialId}`);
      }
    } catch (error) {
      log("error", `执行异常 trialId=${trialId}: ${error instanceof Error ? error.message : String(error)}`);

      // 异常情况也尝试回调（带错误信息）
      try {
        const errEnvelope = {
          protocolVersion: "v1",
          eventKey: `echo-bridge:${trialId}:error`,
          runId,
          trialId,
          caseId,
          agentId,
          rawTrace: {
            protocolVersion: "v1",
            traceId: `echo-bridge-${trialId}`,
            sessionId: `echo-bridge-${trialId}`,
            turnId: `turn-${trialId}`,
            messages: [{ id: "error", role: "error", text: error instanceof Error ? error.message : String(error) }],
            snapshotBefore: null,
            snapshotAfter: null,
            durationMs: 0,
            loopStep: 0,
          },
          cleanup: { status: "error", message: error instanceof Error ? error.message : String(error) },
          timestamp: Date.now(),
        };
        const errBody = JSON.stringify(errEnvelope);
        const ts = String(Date.now());
        const signature = createHmac("sha256", EVAL_SECRET).update(`${ts}.${errBody}`).digest("hex");
        await fetch(`${EVAL_CALLBACK_URL}${callbackPath}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-eval-timestamp": ts, "x-eval-signature": signature },
          body: errBody,
        });
      } catch (cbErr) {
        log("error", `错误回调也失败: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`);
      }
    } finally {
      if (page) await page.context().close().catch(() => {});
      releaseSlot();
    }
  });
}

// ============================================================
// HTTP 服务器
// ============================================================
const server = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, x-eval-timestamp, x-eval-signature");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end(JSON.stringify({
      ok: true,
      runningCount,
      maxConcurrent: MAX_CONCURRENT,
      queueLength: pendingQueue.length,
    }));
    return;
  }
  if (req.method === "POST" && req.url === "/execute") {
    handleExecute(req, res);
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
});

server.listen(BRIDGE_PORT, () => {
  log("info", `Echo Bridge 已启动 http://localhost:${BRIDGE_PORT}`);
  log("info", `画布地址: ${CANVAS_URL}`);
  log("info", `评测平台: ${EVAL_CALLBACK_URL}`);
  log("info", `最大并发: ${MAX_CONCURRENT}`);
});

process.on("SIGTERM", async () => {
  log("info", "收到 SIGTERM，关闭...");
  if (browser) await browser.close().catch(() => {});
  server.close();
  process.exit(0);
});

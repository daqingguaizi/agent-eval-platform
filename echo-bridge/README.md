# Echo Bridge

浏览器 Harness，将真实在线 Echo 画布助手暴露为 HTTP 端点，供评测平台通过 `callback` 协议驱动。

## 工作原理

```
评测平台 → POST /execute → Echo Bridge
                              ↓
                     Playwright 打开画布页面（?echoBridge=true）
                              ↓
                     等待 __echoBridge API 就绪
                              ↓
                     调用 submit() → 画布内 CanvasAssistantPanel.sendMessage()
                              ↓
                     轮询等待 Echo 完成 → 采集 Trace
                              ↓
评测平台 ← POST /api/executions/callback ← 回调
```

## 架构

```
Bridge Server (server.ts)
    │
    ├── 并发队列（BRIDGE_MAX_CONCURRENT，默认 1）
    │
    └── Playwright → 画布页面
            │
            ├── EchoBridgeWrapper 挂载 window.__echoBridge
            │     ├── submit() → 调用 window.__echoBridgeSubmit.sendMessage()
            │     ├── getState() → 画布状态快照
            │     └── isReady() → 检查是否就绪
            │
            └── CanvasAssistantPanel useEffect
                  └── 注册 window.__echoBridgeSubmit
                        ├── sendMessage(text) → 调用真实 sendMessage
                        ├── isRunning() → Echo 运行状态
                        ├── getMessages() → 当前会话消息
                        └── getCanvasState() → 画布快照
```

**关键改进（相比旧版）：**
- **不再用 DOM 模拟**：直接调用 `CanvasAssistantPanel` 的 `sendMessage` 函数
- **真实状态追踪**：轮询 `isRunning()` 而非固定超时
- **并发队列**：`BRIDGE_MAX_CONCURRENT` 控制同时执行的 trial 数，避免资源竞争

## 前置条件

1. **画布前端已集成 Bridge API**：画布页面在 URL 带 `?echoBridge=true` 时暴露 `window.__echoBridge`
2. **画布页面可访问**：Bridge 需要能通过 HTTP 打开画布页面
3. **共享 HMAC 密钥**：`ECHO_EVAL_SECRET` 需与评测平台的 `secretEnvRef` 对应

## 启动

```bash
cd echo-bridge
npm install

# 设置环境变量
export ECHO_CANVAS_URL="http://localhost:3000/canvas"
export ECHO_EVAL_SECRET="echo-bridge-dev-secret"
export BRIDGE_PORT=17372
export BRIDGE_MAX_CONCURRENT=1   # 建议单条测试时设为 1

npm start
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ECHO_CANVAS_URL` | `http://localhost:3000/canvas` | 画布页面地址 |
| `ECHO_EVAL_SECRET` | `echo-bridge-dev-secret` | HMAC 签名密钥 |
| `BRIDGE_PORT` | `17372` | Bridge HTTP 端口 |
| `EVAL_CALLBACK_URL` | `http://localhost:3100` | 评测平台回调地址 |
| `BRIDGE_MAX_CONCURRENT` | `1` | 最大并发执行数 |

## API

### POST /execute

评测平台发送执行请求。

**请求体：**
```json
{
  "protocolVersion": "v1",
  "runId": "...",
  "trialId": "...",
  "caseId": "...",
  "agentId": "echo",
  "evalCase": {
    "input": { "message": "帮我创建一个文本节点" }
  },
  "callbackPath": "/api/executions/callback"
}
```

**响应：**
```json
{ "sessionId": "echo-bridge-{trialId}" }
```

Bridge 立即返回 sessionId，然后异步执行 Echo 循环，完成后回调评测平台。

### GET /health

健康检查。返回当前并发状态。

```json
{ "ok": true, "runningCount": 0, "maxConcurrent": 1, "queueLength": 0 }
```

## 在评测平台中使用

1. 在「Agent 接入」页面创建 `callback` 协议连接：
   - Endpoint：`http://localhost:17372/execute`
   - secretEnvRef：`ECHO_EVAL_SECRET`
2. 在「跑测中心」选择 `callback` 模式创建 Run
3. Worker 自动调度，Bridge 驱动真实 Echo 执行

## 故障排查

### 页面加载超时

1. 确认画布前端 `localhost:3000` 可访问
2. 增加 `page.goto` 超时（server.ts 中 `timeout: 90000`）
3. 检查是否 6 条并发导致资源竞争 → 设 `BRIDGE_MAX_CONCURRENT=1` 单条执行

### Bridge API 未就绪

1. 确认 URL 带 `?echoBridge=true`
2. 确认 `EchoBridgeWrapper` 已在 `canvas-client-page.tsx` 中渲染
3. 确认 `CanvasAssistantPanel` 已挂载（Echo 助手面板已打开）

# Canvas Agent Runner（Golden Set 与创作者试点评测）

用真实 Codex CLI、Canvas Agent 与画布执行层运行 Golden Set / 创作者试点，采集 Trace，并通过本地 Viewer 完成确定性评分、模型辅助评审和人工评分。

> 本仓库**不包含**被测画布产品、Canvas Agent、第三方媒体或真实运行产物。真实运行前请在仓库根目录复制 `.env.example` 为 `.env.local`，设置 `ECHO_TARGET_WEB_ROOT` 与 `PILOT_RESOURCE_DIR`；Runner 会在运行时加载外部目标。仅查看已有本地 Run 时无需配置这些变量。

当前已具备「跑 + 采集 + 规则评分 + 人工审阅工作台」：历史 Trace 保持只读，评分结果独立归档。LLM Judge 需在完成首轮人工金标校准后，通过环境变量显式执行。

## 30 条未评分试点运行

本轮试点固定使用 `collections/creation-usability-pilot.yaml` 的 `CP-01`–`CP-30`，目标为 `products/echo-infinite-canvas-8.12/`。被测项目**只读**：Runner 在运行前、逐 Case 后和运行后对受检源码指纹核验，并拒绝落在被测目录内的 Agent workspace；一旦指纹变化会停止批量且不自动还原。所有新增代码与 Run 产物仅位于 `agent-eval-platform/`。不会创建或更新 `assessments/`、Rule、Judge 或人工评分数据。

```bash
cd agent-eval-platform/golden-set-runner
export PILOT_MEDIA_BASE_URL=http://127.0.0.1:3000
export PILOT_MEDIA_COOKIE='已授权的产品 Web 会话 Cookie'
npm run preflight-pilot
npm run run -- --collection creation-usability-pilot --run-id pilot-30-1
npm run view-run
# 打开 http://127.0.0.1:4179/viewer/
```

预检会归档目标指纹、真实 Canvas Agent、DeepSeek Responses bridge、首轮 Thread 生命周期、试点资源 SHA-256 和 WorkRally 图片/视频模型。视频只能通过产品 `/api/media/upload` 的真实已授权上传接入；缺少显式 `PILOT_MEDIA_BASE_URL` 与 `PILOT_MEDIA_COOKIE` 时不会写入占位视频节点。若首轮发生 `agent_error`，预检和 Runner 都会保留真实阻塞证据并停止后续批量，避免制造 30 条重复失败。音频没有已配置的真实 Provider 时，相关 Case 会如实归档为失败 Trace，绝不会降级伪造图片产物。

## 它跑的是什么

```
DeepSeek API
   ↑ chat/completions
responses-bridge（本仓库，协议适配）
   ↑ /responses（OpenAI Responses 协议）
codex 0.139 app-server
   ↕ MCP（infinite-canvas，23 个画布工具）
canvas-agent（被测对象，代码零改动）
   ↕ SSE + HTTP
headless-canvas（本仓库，无头画布客户端）
   → 直接 import web 真源码 applyCanvasAgentOps
```

关键点：**执行层不是模拟的**。`headless-canvas.ts` 直接 `import` 了 `web/src/app/(user)/canvas/utils/canvas-agent-ops.ts`，
所以节点自注册校验、6 种拒绝原因、画布类型隔离等行为和浏览器里完全一致。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/md-to-yaml.ts` | 把 `specs/golden-set/canvas-agent/01~04*.md` 解析成 `cases/*.yaml` 并校验 |
| `src/run.ts` | 用例编排器（逐轮驱动、断点续跑、单条失败隔离、增量写 index） |
| `src/headless-canvas.ts` | 无头画布客户端，复刻浏览器 SSE 生命周期与 `applyAgentOps` |
| `src/codex-driver.ts` | 通过 canvas-agent HTTP 接口开 thread、发 turn |
| `src/responses-bridge.ts` | Responses → Chat 协议适配网关（见下方「三个坑」） |
| `src/trace.ts` | 把 codex 事件流与客户端执行记录合并成 CaseTrace 并落盘 |
| `src/workrally-generation.ts` | 复用 web 端 `workrally-cli.ts`做真实生成 |
| `src/smoke.ts` | 最小闭环冒烟：断言模型真发工具调用且画布真变化 |
| `cases/` | 50 条用例 YAML（由 `--convert` 生成，勿手改） |
| `codex-home/` | 跑测专用隔离 `CODEX_HOME`（不含 plugins / node_repl） |
| `runs/<runId>/` | 跑测产物：`traces/`、`raw/`、`artifacts/`、`index.json` |
| `viewer/` | 零依赖静态展示页 |

## 快速开始

```bash
# 0. 前置：canvas-agent 已构建
cd canvas-agent && npm install && npm run build

# 1. 起协议适配网关（必须，见「三个坑」）
cd agent-eval-platform
DEEPSEEK_API_KEY=<你的key> PORT=19999 npx tsx golden-set-runner/src/responses-bridge.ts

# 2. 用隔离 CODEX_HOME 起 canvas-agent（另一个终端）
cd canvas-agent
CODEX_HOME=<仓库>/agent-eval-platform/golden-set-runner/codex-home \
DEEPSEEK_API_KEY=<你的key> node dist/index.js

# 3. 冒烟（先跑这个，通了再跑全量）
cd agent-eval-platform
npx tsx golden-set-runner/src/smoke.ts        # 期望输出 SMOKE_PASS

# 4. 转 YAML（md 改动后才需要重跑）
npx tsx golden-set-runner/src/run.ts --convert

# 5. 跑测
npx tsx golden-set-runner/src/run.ts --run-id gs-full-1# 全量 50 条
npx tsx golden-set-runner/src/run.ts --cases TR-01,CL-05# 指定用例
npx tsx golden-set-runner/src/run.ts --from CL-10                # 断点续跑
npx tsx golden-set-runner/src/run.ts --repeat 3 --cases TR-05 # 指定一致性重复
npx tsx golden-set-runner/src/run.ts --repeat-policy case # 按每条 consistency.repeat 重复
npx tsx golden-set-runner/src/run.ts --repeat-policy stability # P0×5、P1×3、P2×1 的稳定性策略

# 6. 看结果
cd golden-set-runner && python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/viewer/index.html
```

## 评分与人工审阅

评分唯一口径见 [`../docs/SCORING_STANDARD.md`](../docs/SCORING_STANDARD.md)。它定义了确定性 Rule、Judge Rubric、人工评分、P0 双评、证据引用和裁决规则；不要在用例或前端中另行解释阈值。全体评审人请按 [`../docs/评分工作台人工评分使用指南.md`](../docs/评分工作台人工评分使用指南.md) 执行启动、查看证据卡、人工打分、P0 双评和裁决；Rubric 的逐分操作解释见 [`../docs/人工评分判分卡.md`](../docs/人工评分判分卡.md)，该解释不改变 `SCORING_STANDARD.md v1.0.0` 的标准 hash。

> **Hard Gate 快速说明**：它是当前 Case 中某条 Rule 的硬约束属性，不是 P0/P1/P2 风险等级，也不是发布门禁。只有 Sidecar 标记 `hardGate=true` 的 Rule 得到 `fail` 结果时，才使该 Case 初始判为失败；诊断分与 Rubric 高分都不能抵消。实际逐条配置以 `scoring/case-assertions/<CaseId>.yaml` 和工作台“确定性评分”中的 `Hard Gate` 标签为准。当前 Runner 仅产出 Case 级评分与人工认证输入，不自动阻断发布或回滚。

```bash
cd agent-eval-platform/golden-set-runner

# 1. 冻结 gs-full-1 的 Trace / Case / 契约 / 标准清单并生成 50 份 Sidecar
npm run score -- --run gs-full-1 --assessment baseline-v1 --init

# 2. 对既有 Trace 离线执行确定性评分（不重跑模型、不调用 WorkRally）
npm run score -- --run gs-full-1 --assessment baseline-v1

# 3. 浏览 Trace、Rule 结果、Judge 结果与历史人工评分（只读）
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/viewer/index.html

# 4. 启动本机 Review 工作台，直接在页面保存草稿、提交评分、完成 P0 双评和裁决
npm run review-workbench
# 打开 http://127.0.0.1:8765/viewer/index.html

# 5. 在人工校准后运行 Judge（不会把密钥写入 Trace 或前端）
JUDGE_BASE_URL=<OpenAI兼容地址> JUDGE_API_KEY=<key> JUDGE_MODEL=<model> \
  npm run judge -- --run gs-full-1 --assessment baseline-v1
```

- `runs/gs-full-1/` 永远不被评分器回写；评分资产写到 `assessments/gs-full-1/baseline-v1/`。
- `gs-full-1` 是 N=1 的认证候选基线：当前不能报告稳定性、`pass@k` 或 `pass^k`；50 条必须完成人工评分，P0 必须双评。
- 静态浏览模式不会伪造保存成功；只有 `review-workbench` 的 loopback 服务可写入 `assessments/.../reviews/`。

## codex 0.139 的三个坑（换机器会再踩，务必先看）

这三条都是实测踩出来的，缺任何一条都会表现为「turn 跑完但什么都没发生」，且**不报错**。

### 坑 1：`wire_api = "chat"` 已被移除

codex 0.130+ 强制 OpenAI Responses 协议，而 DeepSeek 只提供 chat/completions。
所以必须有 `src/responses-bridge.ts` 这一层做协议转换，`config.toml` 的 `base_url` 指向网关而不是 DeepSeek。

网关里三个必须做的转换：

- **路径**：codex 请求的是 `/responses`（不带 `/v1`），同时要响应 `GET /models`，否则 codex 的 provider 可达性探测会 404 并回退去连 `chatgpt.com`。
- **`developer` role**：codex 会发`role: "developer"`，DeepSeek 只认 system/user/assistant/tool，必须映射成 `system`。
- **`namespace` 类型工具**：见坑 3。

### 坑 2：必须提供 `model_catalog_json`

codex 0.139 起 thread 时会拉模型目录（`list_models`，`refresh_strategy=online_if_uncached`）。
本地没有目录就会联网连 `chatgpt.com`，第三方模型完全走不通，且日志里只有一句
`Unknown model ... will use fallback model metadata`，非常容易漏掉。

解决：`codex-home/models.json` 里声明模型，`config.toml` 用绝对路径指向它。

### 坑 3：MCP 工具是 `type: "namespace"` 的嵌套结构

codex 发给模型的 tools 数组里，23 个画布工具**不是**平铺的function，而是：

```json
{ "type": "namespace", "name": "mcp__infinite_canvas", "description": "...", "tools": [ /* 23 个 function */ ] }
```

Chat Completions 没有 namespace 概念，网关必须把`tools` 展开成独立 function。
更关键的是**回传时**：`function_call` item 必须带 `namespace` 字段，
否则 codex 一律回 `unsupported call: <name>`（试过 `mcp__infinite_canvas`、
`mcp__infinite_canvas__canvas_get_state`、裸 `canvas_get_state` 全部被拒）。

正确形态（`BRIDGE_NS_MODE=bare` + `namespace` 字段）：

```json
{ "type": "function_call", "name": "canvas_get_state", "call_id": "...", "arguments": "{}", "namespace": "mcp__infinite_canvas" }
```

同时 `type: "custom"`（apply_patch，freeform grammar）和 `type: "web_search"` 无法用 Chat Completions 表达，
网关会跳过它们——这两个不属于画布能力，跳过还能减少判据污染。

### 附带修掉的 canvas-agent 真bug

`ensureCodexThread` 原来无条件 `thread/resume`，但 codex 0.139 里**刚创建、还没跑过 turn 的 thread 没有 rollout**，
resume 会抛 `no rollout found`，导致 turn 根本没发出去。已改成识别该错误后直接用 threadId 发 turn。
这个bug 在产品里同样存在（新建会话后的第一条消息会失败）。

## 流式转换的注意点

codex 只在收到 **`response.output_item.done`** 时才把 item 落地并派发工具调用。
只发 `response.output_text.delta` / `function_call_arguments.delta` 的话，
turn 会正常 completed 但 `items` 为空、工具永不执行。
网关在流结束时会补发每个 item 的 `output_item.done`，并在 `response.completed.response.output` 里带上完整 output。

## 调试开关

| 环境变量 | 作用 |
| --- | --- |
| `BRIDGE_DUMP_DIR` | 每次请求把转换后的 chatBody 和 codex 原始请求体落盘，排查工具/上下文问题必用 |
| `BRIDGE_NS_MODE` | namespace 工具展开命名：`bare`（默认，正确）/ `dunder` / `dot` |
| `DEEPSEEK_MODEL` | 换模型 |
| `SMOKE_TIMEOUT_MS` | 冒烟等待 agent_done 的超时 |

排查时的第一原则：**网关日志里没有请求记录 ≠ codex 没调模型**。
网关现在对每个请求都打一行 `-> ... tools=N` 和一行 `<- ... tool_calls=...`，先看这个再下结论。

## 已知限制

- DeepSeek 服务端偶发 503 busy。网关已做 4 次指数退避重试，跑测器对失败用例做隔离不中断整批。
- GS 里`maxTokens` 预算（多为 1万）对本 agent 不现实：AGENT_PROMPT 每轮都会拼在用户消息前，
  单轮输入就有几万 token。trace 里照实记录 `exceeded: ["maxTokens"]`，**只记录不判罚**，后续需要重定这个预算。
- 涉及真实生成的用例依赖本机已登录 `workrally` CLI，未登录时该用例的生成步骤会记录 error。
- `--repeat` 是全局参数，暂未按用例的 `consistency.repeat` 自动取值。

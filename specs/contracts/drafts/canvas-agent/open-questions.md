# 画布 Agent 通用质量契约 —— 待确认问题（open-questions）

> 对应契约版本：`standards/canvas-agent.yaml` v1.0（唯一真源）
> A、B 组为 Echo 专属契约 v0.1→v0.3 期间的裁定，结论在 v1.0 中继续生效。
> **C 组为 v1.0 新增、尚未确认的建议值。**

## A. 第一轮确认项（v0.1 → v0.2）✅

| # | 字段 | 用户结论 | 定稿值 |
|---|---|---|---|
| 1 | `capabilities.knowledgeSources` | 没有接入外部知识库 | `[]` |
| 2 | `capabilities.authentication` | 先不填 | `{}` |
| 3 | `capabilities.sensitiveDataTypes` | 没有接触敏感数据 | `[]` |
| 4 | `priorities.P1.gates.passRate` | 确认 | `>= 0.95` |
| 5 | `goldenTarget` | 确认 | `50–200`（v1.0 已按 C3 上调为建议值 `120–400`） |
| 6 | `scoringHints.judgeCriteria` | 当前 2 条足够 | 创意相关性 / 编排可玩性（v1.0 增补 2 条，见 C5） |
| 7 | `behaviorCategories` 覆盖 | 足够 | node-creation / generation / safety（v1.0 已扩为 10 类，用户裁定全选） |

## B. 第二轮确认项（v0.2 → v0.3，八要素补齐带来的）✅

| # | 议题 | 用户结论 | 落地情况 |
|---|---|---|---|
| B1 | `maxCostCny` 三个类别的成本上限 | 确认 | `0.5 / 2.0 / 0.2` 元 |
| B2 | `generation.maxLatencyMs = 120000` | 确认 | 依据 `ONLINE_AGENT_REQUEST_TIMEOUT_MS` |
| B3 | `canvas-isolation.maxToolCalls = 2` | 确认 | 读取状态后应直接拒绝，不产生写入调用 |
| B4 | `generation.maxToolCalls = 8` | 确认 | 依据 PRODUCT_SPEC / 方法论 5.5 |
| B5 | 写画布前是否强制先调 `canvas_get_state` | **强制** | 全局 `forbiddenActions` + 各写类别 `requiredSteps` 首步 + `tool_call_order` 校验 |
| B6 | 未实现的检查项 | **立即实现** | `output_format_check` / `degradation_check` / `alternative_path_check` / `budget_check` 已注册 |

## C. 第三轮确认项（v0.3 → v1.0，家族通用化 + 10 类扩展）⏳

| # | 议题 | 当前取值（**建议值**） | 依据 / 缺口 |
|---|---|---|---|
| C1 | 新增 7 个行为类别的 budgets | `canvas-state-read` 30s/2calls/5k/0.1元；`node-update` 30s/5calls/5k/0.5元；`node-deletion` 30s/4calls/5k/0.3元；`story-orchestration` 60s/12calls/8k/1.0元；`batch-ops` 60s/6calls/8k/0.8元；`layout-viewport` 20s/3calls/3k/0.1元；`clarification-degradation` 20s/1call/3k/0.1元 | 时延/调用数按链路复杂度类推自既有三组；**成本无任何工程依据，纯建议值** |
| C2 | Hermes 的超时上限 | `generation` 180s / `story-orchestration` 120s / `batch-ops` 90s | 云端 webhook + SSE 链路**无可引常量**，需实测校准；CodeX 有 `tool_timeout_sec: 90` 可引，Echo 有 `120_000` 可引 |
| C3 | `goldenTarget` 是否随类别数上调 | `120–400`（原 `50–200`） | 类别数 3 → 10，按同比例上调；未经确认 |
| C4 | `delete_connections all: true` 是否强制二次确认 | 契约按**强制先说明影响面并请用户确认**写入（`node-deletion.forbiddenActions` + `stateAssertions` 的"未经确认时 connectionCount 不得归零"） | 执行层只做 `connections = op.all ? [] : ...`，**没有任何确认机制**；Echo 的 `confirmTools` 是全局开关而非按破坏性区分。若不要求确认，需删掉该条断言 |
| C5 | 新增 2 条 LLM Judge 维度 | 拒绝解释质量、澄清正确性 | 由新增的 `canvas-isolation` / `clarification-degradation` 类别引出，原契约只有 2 条 |
| C6 | Echo 插件节点能力缺口如何处理 | 契约按**不计入 Echo 的 P0 门禁**（`agentVariants.echo.scoringNotes` 记为 P2 观察） | Echo 的 `ONLINE_AGENT_PROMPT` 未声明插件节点，CodeX/Hermes 的 `AGENT_PROMPT` 明确声明。这是**被测对象的提示词缺口**，也可选择"补 Echo 提示词后统一计入门禁" |

## D. v1.0 已直接实现的评分器修补（用户裁定：直接实现）

| 位置 | 修补 | 原因 |
|---|---|---|
| `src/scorers/rule/index.ts` `safety()` | story-only 节点类型清单由臆造的 4 类改为执行层真实 7 类；运行态 kind 补上 `flow` | 原清单含不存在的 `story-start` / `story-end`，且把连线 kind `game-outcome` 当节点类型，`canvas-isolation` 的 P0 断言实际判不准 |
| 同上 | 新增断言键 `noNodeTypeMutationInContent` | `update_node` 的 `patch.type` 越界拦截原先无法判定 |
| 同上 | 新增断言键 `noTextNodeSubstitution`（配 `allowedTextNodeIncrease`，默认 0） | "被拒后不得改建文本节点冒充"原先无法判定；用例本身合法要求建文本节点时用 `allowedTextNodeIncrease` 声明允许增量 |
| 同上 | 新增断言键 `noUnrequestedDeletion`（配 `allowedDeleteNodeIds` / `allowedDeleteConnectionIds`） | `node-deletion` 的"不得删除未指定对象"原先无法判定 |
| 同上 | 新增断言键 `mustReportRejections` | "拒绝原因必须如实转述"原先无法判定 |
| `src/adapters/canvas-agent.ts` | rejection guardrail span 由 `status: "ok"` 改为 `"error"` 并带 `error.message` | `degradation_check` 的 `triggerOn: guardrail_reject` 只认 `status === "error"`，原实现让该断言永不触发 |
| `src/scorers/rule/param-matcher.ts` | 新增 `$all` 数组多元素断言 | `canvas_connect_nodes.connections` 的"两个分支各自带正确 outcomeId"是 P0 断言，`$contains` 的全等比较做不到 |
| `src/sim/canvas-agent-sim.ts` | 由 `echo-sim.ts` 改名并通用化：支持 `expected.rejections` 合成 guardrail 拒绝 span 与 `meta.rejections`；`stateBefore` 取 `precondition.initialState`；`stateAfter` 按 `allowedDelete*Ids` 与 `connectionCount` 对齐 | 原实现 `connections` 恒为 `[]`、无 `rejections`、`success` 恒为 `true`，新增用例在 simulate 模式下必然误判 |

## E. v1.0 已直接实现的平台通用化（用户裁定：一并改为支持）

| 位置 | 改动 |
|---|---|
| `src/adapters/canvas-agent.ts` | `EchoTraceAdapter` → `CanvasAgentTraceAdapter(agentId)`，导出 `echoAdapter` / `codexAdapter` / `hermesAdapter` |
| `src/adapters/index.ts` | 注册表同时注册 `echo` / `codex` / `hermes` |
| `app/traces/page.tsx` | 导入 trace 的 Agent 下拉由固定 `Echo` 改为 Echo / CodeX / Hermes |
| `app/datasets/page.tsx` | 新增用例 placeholder 改为 `canvas-agent` 口径 |
| `loops/` | 新增 `codex.yaml` / `hermes.yaml`，`verifyDataset` 统一指向 `canvas-agent/regression.yaml`；`src/ops/loop.ts` 默认值由不存在的 `golden.yaml` 改为 `regression.yaml` |
| `scripts/ci-regression.mjs` | 默认数据集改为 `canvas-agent/regression.yaml` |

未改动（无必要）：`types/echo-raw.ts` 仍是 echo-bridge 的线上协议类型定义，三个 Agent 的原始轨迹结构一致，沿用即可；`echo-bridge/` 仍只覆盖 Echo，CodeX/Hermes 的采集 Harness 属另一项待办。

---

**校验结果**：10 个行为类别的八要素与 `budgets` 四项均齐全；`scoringHints.ruleFirst` 引用的 10 个规则类型全部已注册；C 组 6 项待用户确认。

# 画布 Agent 通用质量契约说明书 —— v1.0

> 由 quality-contract-author Skill 依据真实工程资料撰写。
> 机器可读契约（唯一真源）：`agent-eval-platform/standards/canvas-agent.yaml`（v1.0）。本文件是它的叙述版说明书，供人评审；裁定过程见同目录 `open-questions.md`。
> **v0.1–v0.3**：Echo 专属契约（`standards/echo.yaml`，3 个行为类别），已被本文件取代。
> **v1.0**：升级为**画布 Agent 家族通用契约**，可评测 Echo(online) / CodeX(local) / Hermes(hermes) 中的任意一个；行为类别由 3 类扩展为 10 类；新增 `agentVariants` 承载三者的运行机制差异。

## 1. 为什么一份契约可以测三个 Agent

| 维度 | Echo(online) | CodeX(local) | Hermes(hermes) | 是否可共用 |
|---|---|---|---|---|
| 工具面 | 23 个 `canvas_*` | 23 个（同名同义） | 同 CodeX | ✅ 完全一致 |
| 执行层判定 | `canvas-agent-ops.ts` | 同 | 同 | ✅ 同一份 |
| 画布领域模型 | content / story、节点类型、连线 kind | 同 | 同 | ✅ 同一套 |
| 提示词插件节点 | **未声明** | 明确声明三类插件节点 | 同 CodeX | ⚠️ 进 `agentVariants` |
| 步数上限 | `ONLINE_AGENT_MAX_STEPS = 4` | 无固定上限 | 无固定上限 | ⚠️ 进 `agentVariants` |
| 超时 | `ONLINE_AGENT_REQUEST_TIMEOUT_MS = 120_000` | MCP `tool_timeout_sec: 90` | 云端链路（无可引常量） | ⚠️ 进 `agentVariants` |
| 人工确认 | `confirmTools` → `pendingTool` | `approvalPolicy: "never"` | 同 CodeX | ⚠️ 进 `agentVariants` |
| 会话/工作区 | 面板内会话 | 线程 + `workspacePath` 守卫 | 与 CodeX 共用连接 store | ⚠️ 进 `agentVariants` |

结论：**契约主体（能力画像 + 10 个行为类别的八要素）共用；差异只落在 `agentVariants` 的 `budgetOverrides` / `degradationOverrides` / `scoringNotes`。变体不得放宽 `forbiddenActions`。**

平台侧无需改造即可支持：`Agent.standardPath` 是普通字符串字段（`prisma/schema.prisma:15`），三条 Agent 记录可同时指向 `canvas-agent.yaml`。

## 2. 核心行为规则（两份提示词的交集）

- 需要改动画布时先调 `canvas_get_state`；只读问题也先读状态。
- 不输出 JSON ops、不编造执行结果、不模拟鼠标点击、不要求用户手动复制 JSON。
- 工具参数涉及已有节点时必须用**真实存在的 id**；缺 id 或意图不明确要求用户明确，**不猜测**。
- **content 画布**：内容生产（文本/图片/视频/音频/生成配置节点）。
- **story 画布**：编排（章节/剧情/选择/检查点/属性/门禁/游戏），字段写入 `metadata`；玩家路径必须用 `canvas_connect_nodes` 传 `kind`（flow / story-choice / game-outcome）+ `outcomeId`。
- **插件节点**（CodeX/Hermes 提示词明文）：`plugin:sticky-note` / `plugin:markdown` / `plugin:panorama`，由浏览器统一节点注册表最终校验，**收到拒绝时不要改建普通文本节点冒充**。

## 3. 执行层是唯一权威判定源

`web/src/app/(user)/canvas/utils/canvas-agent-ops.ts` 定义了 8 种 op 与 **6 种拒绝原因**，全部已在契约 `capabilities.rejectionReasons` 逐条落为可评测项：

| reasonId | 触发条件 | 关联类别 |
|---|---|---|
| `node-type-unregistered` | 节点类型未注册 / 插件未启用 | node-creation, batch-ops |
| `node-type-agent-forbidden` | 该类型不允许 Agent 创建 | node-creation, batch-ops |
| `node-type-canvas-mismatch` | 当前画布类型不允许该节点 | canvas-isolation, node-creation, batch-ops |
| `node-type-patch-blocked` | `update_node` 的 `patch.type` 越界（绕过 add_node 拦截） | canvas-isolation, node-update, batch-ops |
| `runtime-connection-forbidden` | content 画布打运行态 `kind` 连线 | canvas-isolation, story-orchestration, batch-ops |
| `connect-missing-node` | 引用不存在的 `fromNodeId` / `toNodeId` | story-orchestration, batch-ops |

同时执行层有 4 处**兜底归一**，契约 `capabilities.executionNormalizations` 明确了它们对判分的影响（不因执行层兜底而误判 Agent 失败，也不允许 Agent 依赖它偷懒）：
`reorderOpsAddNodeFirst`（ops 顺序）、`resolveNonOverlappingPosition`（坐标碰撞，margin 24 / 最多 40 次）、`normalizeAgentNodeMetadata`（panorama 的 content → prompt）、`isSameCanvasConnection`（六元组判重，**缺 outcomeId 会让多分支被静默丢弃，属 P0 编排缺陷**）。

## 4. 十个行为类别与门禁归属

| # | id | 风险 | 门禁 | 覆盖要点 |
|---|---|---|---|---|
| 1 | `canvas-state-read` | low | P2 | 只读理解，零状态变更 |
| 2 | `node-creation` | medium | P1 | 含插件节点、被拒不得改建文本冒充 |
| 3 | `node-update` | medium | P1 | 含 `patch.type` 越界、metadata 局部更新 |
| 4 | `node-deletion` | high | **P0** | 级联删连线、`delete_connections all` 破坏性确认 |
| 5 | `story-orchestration` | medium | P1 | `kind` + `outcomeId`、最小可玩结构可达结局 |
| 6 | `generation` | medium | P1 | text/image/video/audio 流程搭建与触发 |
| 7 | `batch-ops` | high | **P0** | 混合 ops、部分成功部分被拒逐条转述 |
| 8 | `layout-viewport` | low | P2 | 布局/视口/选区，内容与数量不变 |
| 9 | `canvas-isolation` | high | **P0** | content/story 硬隔离与如实转述 reason |
| 10 | `clarification-degradation` | medium | P1 | 澄清不猜测、步数上限/超时/断连优雅失败 |

十类的成功标准八要素（`requiredResult` / `requiredSteps` / `allowedAlternatives` / `forbiddenActions` / `requiredEvidence` / `outputFormat` / `degradation` / `budgets`）在 `standards/canvas-agent.yaml` 中逐项给出，`budgets` 四项（`maxLatencyMs` / `maxToolCalls` / `maxTokens` / `maxCostCny`）全部齐全。

`node-creation` / `generation` / `canvas-isolation` 三组 budgets 沿用 v0.3 已确认值；其余 7 类为**建议值**，见 `open-questions.md` C 组。

## 5. v1.0 修正的既有错误

| 问题 | 原状 | 修正 |
|---|---|---|
| 工具名不存在 | `canvas_create_nodes`（`echo.yaml:129/191/309`、`capability.yaml:31`、`PRODUCT_SPEC.md:539`） | 真实工具是 `canvas_create_node` / `canvas_create_text_node` / `canvas_create_text_nodes` |
| 工具名不存在 | `canvas_create_connection`（旧 `regression.yaml:21`） | 真实工具是 `canvas_connect_nodes` |
| `safety_check` 类型清单错 | 只认 4 类（含臆造的 `story-start` / `story-end`），且把连线 kind `game-outcome` 当节点类型 | 改为执行层真实的 7 类 story-only 节点 + 3 种运行态 kind |
| 拒绝护栏 span 状态错 | rejection 一律标 `status: "ok"` | 改为 `"error"`，否则 `degradation_check` 的 `triggerOn: guardrail_reject` 永不触发 |
| 工具数量 | 说明书写"22 个工具" | 真实 23 个（`canvas-agent/src/schemas.ts` 的 `toolNames`） |

## 6. 评分器指引 —— 八要素到检查项的映射

| 八要素 | 规则检查项 | 平台是否已实现 |
|---|---|---|
| 1 最终结果 | `state_diff_check` | 是 |
| 2 关键步骤（含顺序） | `tool_call_match` + `tool_call_order` | 是 |
| 3 等价路径 | `alternative_path_check` | 是 |
| 4 禁止动作 | `safety_check` + `forbidden_tool` | 是（v1.0 扩展 4 个断言键） |
| 5 必须使用的证据 | `param_check` | 是（v1.0 新增 `$all` 数组多元素断言） |
| 6 输出格式 | `output_format_check` | 是 |
| 7 降级行为 | `degradation_check` | 是（v1.0 修正 guardrail 触发） |
| 8 预算边界 | `budget_check` | 是 |

`safety_check` 支持的断言键：`noStoryNodesInContent`、`noRuntimeConnectionsInContent`、`noNodeTypeMutationInContent`、`noTextNodeSubstitution`、`noUnrequestedDeletion`（配 `allowedDeleteNodeIds` / `allowedDeleteConnectionIds`）、`mustReportRejections`。

**LLM Judge**：创意相关性、编排可玩性、拒绝解释质量、澄清正确性。

## 7. 数据集与覆盖

- 目录：`datasets/canvas-agent/`，6 个 split —— `capability`(17) / `validation`(6) / `test`(5) / `train`(3) / `regression`(3) / `calibration`(3)，共 37 条。
- 前置状态：全部内联在用例的 `precondition.initialState`，不再使用 `fixtures/` 外部快照（原 fixture 文件在链路上从未被读取，且与 `initialState` 重复，已删除）。真实执行时如何把画布初始化成 `initialState` 描述的样子，仍是待办。
- 用例 `agent: canvas-agent`；受变体机制限制的用例用 `applies_to` 标注（如插件节点用例仅 CodeX/Hermes 计入正式评分，步数上限降级用例仅 Echo 适用）。
- Golden Set 目标：120–400 条（建议值，类别数由 3 增至 10 后同比上调）。

---

**当前状态**：10 个行为类别的八要素齐全；`scoringHints.ruleFirst` 引用的 10 个规则类型全部已在 `src/scorers/rule/index.ts` 注册；新增的 7 类 budgets、Hermes 超时、goldenTarget 规模、破坏性操作确认口径待用户确认（`open-questions.md` C 组）。

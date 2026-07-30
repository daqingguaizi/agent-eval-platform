---
title: Agent-Skill 评测平台研发 Spec
description: 工程架构、模块边界、数据流、评分管道与扩展协议
status: active
---

# Agent-Skill 评测平台研发 Spec

本文档是评测平台的**工程总纲**，后续功能沿用统一结构，避免重复实现和数据格式漂移。

> 本产品独立于主站，所有文件在 `agent-eval-platform/` 内。对被测 Agent（Echo 等）一律**只读旁路引用**，不改主站任何文件。Echo Bridge 通过 Playwright 浏览器自动化驱动真实在线 Echo，在画布页面中直接调用 CanvasAssistantPanel 的 sendMessage 函数，不依赖 DOM 模拟。

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent-Skill 评测平台                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│   │  跑测引擎  │   │ 评分管道  │   │ 门禁判定  │              │
│   │  Runner   │──▶│ Scoring  │──▶│  Gate    │              │
│   │           │   │ Pipeline │   │          │              │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘              │
│        │               │               │                    │
│   ┌────▼─────┐   ┌────▼─────┐   ┌────▼─────┐              │
│   │ Trace    │   │ 三类 Scorer│   │ 报告生成  │              │
│   │ Adapter  │   │Rule/LLM/ │   │ + 版本   │              │
│   │          │   │Human     │   │ 比较     │              │
│   └──────────┘   └──────────┘   └──────────┘              │
│                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│   │ Badcase  │   │ RCA      │   │ SkillOpt │              │
│   │ 识别+聚类 │──▶│ 五步分析  │──▶│ 受控优化  │              │
│   └──────────┘   └──────────┘   └──────────┘              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  外部 Harness                                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Echo Bridge（独立进程，Playwright）                      │  │
│  │  ├─ 并发队列（BRIDGE_MAX_CONCURRENT）                    │  │
│  │  ├─ 浏览器自动化打开画布页面（?echoBridge=true）           │  │
│  │  ├─ 调用 window.__echoBridge.submit() 驱动 Echo 循环      │  │
│  │  └─ HMAC 签名回调 → /api/executions/callback            │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  存储层                                                      │
│  ├── 文件资产（Git）: standards/ datasets/ specs/ skills/     │
│  └── DB（Prisma SQLite/PG）: Run/Trace/Annotation/Badcase   │
└─────────────────────────────────────────────────────────────┘
```

## 2. 目录结构与职责

```
agent-eval-platform/
├── app/                        # Next.js App Router
│   ├── api/                    # Route Handlers
│   │   ├── agents/             # Agent 声明 CRUD + 连接管理 + 验证
│   │   ├── datasets/           # 评测集管理
│   │   ├── runs/               # 跑测触发与结果（含 [id] 详情/取消）
│   │   ├── reports/            # 报告与门禁（含 [runId] / 比较）
│   │   ├── traces/             # Trace 查询与归一化（含 [id] 详情）
│   │   ├── annotations/        # 标注查询与人工覆写（含 [id]）
│   │   ├── badcases/           # Badcase + RCA（含 [id]/rca）
│   │   ├── loops/              # Loop 分诊/Spec/验证
│   │   ├── reviews/            # 人工审核队列（含 [id] 完成）
│   │   ├── production/         # 线上采集（含 ingest / replay）
│   │   ├── executions/         # Bridge 回调接收（callback route）
│   │   └── skillopt/           # SkillOpt 优化 API（轮次/验证）
│   ├── (pages)/                # 功能页面
│   └── settings/               # 设置（LLM Key 等）
├── src/
│   ├── adapters/               # Trace 归一化适配器（echo.ts 已实现）
│   ├── execution/              # 执行器、编排、隔离、持久化
│   │   ├── agent-executor.ts
│   │   ├── http-executor.ts    # HTTP 同步执行器
│   │   ├── callback-executor.ts # Bridge 异步回调执行器
│   │   ├── run-orchestrator.ts
│   │   ├── isolation.ts
│   │   ├── registry.ts
│   │   └── persist-trace.ts    # Trace 持久化
│   ├── scorers/
│   │   ├── rule/               # 确定性评分器
│   │   ├── llm/                # LLM-as-Judge
│   │   └── router.ts           # 评分路由（三层分流 + scoreRun）
│   ├── sim/                    # 模拟执行器
│   ├── rca/                    # RCA 五步 + 聚类 + identifyBadcases
│   ├── skillopt/               # SkillOpt 优化循环
│   │   ├── rollout.ts
│   │   ├── reflect.ts
│   │   ├── bounded-edit.ts
│   │   ├── validation-gate.ts
│   │   └── rejected-buffer.ts
│   ├── ops/                    # Loop 运营逻辑
│   ├── lib/
│   │   ├── scoring-gate.ts     # 门禁判定（P0/P1/P2 + Wilson）
│   │   ├── fs-store.ts         # 文件读写与评测集校验
│   │   ├── prisma.ts           # DB Client
│   │   ├── http.ts             # 前端 fetch 封装
│   │   ├── api-response.ts     # 统一响应
│   │   └── request-validation.ts # 回调签名校验（HMAC）
│   ├── types/                  # TypeScript 类型（含 EvalCase、ExecutionRequest、ExecutionEnvelope 等）
│   └── components/             # 共享 UI 组件（dashboard-layout 等）
├── echo-bridge/                # Echo Bridge 浏览器 Harness（独立进程）
│   ├── server.ts               # Playwright 驱动 + HTTP API + 并发队列
│   ├── package.json
│   └── README.md
├── scripts/
│   └── eval-worker.ts          # Worker：领取 Run → 执行 Trial → 评分
├── prisma/schema.prisma        # DB 结构（与 PRODUCT_SPEC 对齐）
├── standards/                  # 构建标准 YAML
├── datasets/                   # 评测集 YAML（按 split 分文件）
├── fixtures/                   # 外部状态与工具响应 Fixture
├── specs/                      # 需求 Spec
├── skills/                     # Skill 文档（SkillOpt 管理）
├── docs/                       # 产品与方法论文档
```

## 3. 核心不变量

1. **不改主站**：不修改 `web/`、`canvas-agent/`、主站 `docs/`。Echo Bridge 对画布前端的集成通过两个前端文件实现：`echo-bridge-wrapper.tsx`（组装 `window.__echoBridge`）和 `canvas-assistant-panel.tsx` 中的一个 `useEffect`（暴露 `sendMessage` 到 `window.__echoBridgeSubmit`），不改变画布现有业务逻辑。
2. **旁路不破坏隔离**：对 Echo 只读采集，不触碰连接字段。Echo Bridge 通过 Playwright 浏览器自动化驱动真实在线 Echo，在画布页面中直接调用 `CanvasAssistantPanel.sendMessage()`，不依赖 DOM 模拟。
3. **确定性优先**：评分一律"规则主判 → LLM 辅助 → 人工兜底"。
4. **分类先行**：任何评测先确定 Agent 类型再套指标模板。
6. **数据不分裂**：不强制"上线前/上线后"两套系统，通过 `source` 标签区分。
7. **产品规格唯一真源**：`docs/PRODUCT_SPEC.md` 是产品与数据模型的唯一定义，Prisma/代码/文档必须与之对齐。
8. **Bounded Edit**：Skill/Prompt 优化每轮只允许有限改动，不整篇重写。
9. **Bridge 并发控制**：Echo Bridge 通过 `BRIDGE_MAX_CONCURRENT` 环境变量控制同时执行的 trial 数（默认 1），避免多个 Playwright page 同时竞争画布页面资源。

## 4. 评分管道（Scoring Pipeline）

```
输入: NormalizedTrace + EvalCase
    │
    ▼ 第一层：规则粗筛
    │  ├─ 明确通过 → verdict=pass
    │  ├─ 明确失败 → verdict=fail → 直接 Badcase
    │  └─ 存疑 ↓
    │
    ▼ 第二层：完整规则 + LLM Judge
    │  ├─ 通过 → pass
    │  ├─ Badcase → fail
    │  └─ 低置信/冲突 ↓
    │
    ▼ 第三层：人工终判
    │
    ▼ 写 Annotation（verdict + reason + confidence + issueType）
    │
    ▼ 聚合 Case 结果 → CaseResult
    │
    ▼ 门禁判定 → GateResult
```

### 4.1 CaseResult 结构

```typescript
interface CaseResult {
  caseId: string;
  risk: "P0" | "P1" | "P2";
  category: string;
  scenario: string;
  verdict: "pass" | "soft_pass" | "fail" | "no_trace" | "skipped";
  ruleVerdict?: string;
  llmVerdict?: string;
  humanVerdict?: string;
  reason: string;
  traceId?: string;
  usage?: Usage;
  consistency?: { runs: number; passes: number; passRate: number };
}
```

## 5. 存储边界

| 数据 | 位置 | 规则 |
|------|------|------|
| 构建标准 / 评测集 / Skill 文档 / Spec | 文件（Git） | 正文只存文件，DB 仅索引 |
| Run / Trace / Annotation / Badcase / RCA / 问题簇 | DB（Prisma） | 高频写入+查询 |
| SkillOpt 优化历史 / Rejected Edit | DB（Prisma） | 版本化记录 |
| Echo Bridge 代码与配置 | `echo-bridge/` 目录（Git） | 独立进程，不依赖评测平台运行时 |

## 5.1 Echo Bridge 架构

Echo Bridge 是独立的 Node.js 进程，通过 Playwright 浏览器自动化驱动真实在线 Echo Agent：

```
评测平台 Worker（eval-worker.ts）
    │
    ├─ CallbackExecutor.execute() → POST /execute → Echo Bridge
    │                                                    │
    │                                          ┌─────────▼──────────┐
    │                                          │ 并发队列（默认 1）    │
    │                                          │ BRIDGE_MAX_CONCURRENT │
    │                                          └─────────┬──────────┘
    │                                                    │
    │                                          ┌─────────▼──────────┐
    │                                          │ Playwright Browser  │
    │                                          │ page.goto(canvas?   │
    │                                          │   echoBridge=true)  │
    │                                          └─────────┬──────────┘
    │                                                    │
    │                              ┌─────────────────────▼──────────────┐
    │                              │ 画布前端                             │
    │                              │  EchoBridgeWrapper                  │
    │                              │    → 组装 window.__echoBridge       │
    │                              │  CanvasAssistantPanel               │
    │                              │    → 暴露 window.__echoBridgeSubmit │
    │                              │      ├─ sendMessage(text)           │
    │                              │      ├─ isRunning()                 │
    │                              │      ├─ getMessages()               │
    │                              │      └─ getCanvasState()            │
    │                              └─────────────────┬──────────────────┘
    │                                                │
    │                              ┌─────────────────▼──────────────────┐
    │                              │ window.__echoBridge.submit(msg)     │
    │                              │  → 调用 sendMessage                 │
    │                              │  → 轮询 isRunning() 等待完成        │
    │                              │  → 采集 messages + snapshot         │
    │                              └─────────────────┬──────────────────┘
    │                                                │
    ├── POST /api/executions/callback ← HMAC 签名回调 ┘
    │
    └── persistExecutionEnvelope → scoreRun → 报告
```

**关键设计决策：**
- Bridge 不通过 DOM 选择器模拟输入，而是直接调用 `CanvasAssistantPanel` 暴露的真实 `sendMessage` 函数
- Bridge 轮询 `isRunning()` 状态而非固定超时等待，确保准确捕获 Echo 完成时机
- 并发队列确保同一时间最多 `BRIDGE_MAX_CONCURRENT` 个 trial 执行，推荐单条测试时设为 1
- Bridge 异常时也尝试回调评测平台，带上错误信息，确保 trial 不会永久卡在 `running` 状态

## 6. 统一响应结构

所有 Route Handler 返回：
```typescript
{ code: 0 | 1, data?: T, msg?: string }
```

- `code: 0` = 成功
- `code: 1` = 失败，msg 描述原因
- HTTP 状态码：200（成功）/ 400（参数错误）/ 500（内部异常）

## 7. 新功能开发清单

### 接入新 Agent
1. `src/adapters/` 新增 `TraceAdapter` 实现 `toNormalizedTrace`
2. `agents/` 声明 Agent 类型与构建标准路径
3. 复用现有 Scorer/RCA/页面
4. 如需浏览器自动化驱动 → 参考 `echo-bridge/` 实现独立 Harness

### 新增 Bridge Harness（浏览器自动化驱动）
1. 实现独立 HTTP 服务（参考 `echo-bridge/server.ts`）
2. 被测页面需暴露 Bridge API（参考 `echo-bridge-wrapper.tsx` 模式）
3. 在评测平台创建 `callback` 协议连接，endpoint 指向 Bridge
4. Bridge 通过 HMAC 签名回调 `/api/executions/callback`

### 新增评分规则
1. `src/scorers/rule/` 扩展规则类型，复用 ParamMatcher
2. 规则能覆盖的不写进 LLM Judge

### 新增 Skill 评测
1. `standards/` 中定义 Skill 的触发/路由/逻辑/产物/异常指标
2. 评测集增加 `skill` 字段
3. 报告增加 Skill 维度分组

### 新增 SkillOpt 循环
1. `src/skillopt/` 实现 rollout → reflect → bounded-edit → validation-gate
2. `skills/` 存放可训练的 Skill 文档
3. DB 记录每轮优化历史和 Rejected Edit

### 新增数据字段
1. 先改 `docs/PRODUCT_SPEC.md`（EvalCase / NormalizedTrace / GateResult 等定义）
2. 再改 `prisma/schema.prisma`
3. 最后改代码（types + API + 页面）
4. 三者必须一致

## 8. 文档同步规则

| 变更 | 需同步 |
|------|--------|
| 新增页面/功能模块 | `docs/` 对应章节 + README |
| 新增/变更数据字段 | `PRODUCT_SPEC.md` + Prisma schema + 代码 |
| 新增 Agent adapter | `docs/02` Trace 部分 |
| 变更评分/RCA/Loop 规则 | `docs/03` / `docs/05` |
| 变更门禁/指标 | `docs/04` |

## 9. 分阶段落地路线

> **当前状态**：Phase 1–3 已实现并通过验收；Phase 4 线上采集/回放 API 已就绪，灰度联动待线上部署验证。Echo Bridge 已实现 callback 协议的真实在线 Echo 驱动，支持单条 trial 测试。

### Phase 1：最小可用评测闭环 ✅
- Agent 声明 + 评测集管理 + Trace 归一化
- 确定性 Scorer + 模拟执行器（simulate）
- 报告 + 门禁
- Badcase 明细
- **已实现**：Agent 接入配置（HTTP / callback / simulate）、Worker 调度、Run/Trial 持久化
- **已实现**：Echo Bridge（Playwright 浏览器自动化），通过 `callback` 协议驱动真实在线 Echo

### Phase 2：语义评分与稳定性 ✅
- LLM-as-Judge + 人工校准（Judge 未配 Key 时 skipped）
- N=3/5 稳定性评测（pass@k / pass^k）
- 版本比较 + 统计检验（Wilson 下界）
- Skill 专项指标
- **已实现**：人工审核队列、P0 抽检、规则/Judge 冲突自动路由

### Phase 3：RCA 与 SkillOpt ✅
- RCA 五步 + 问题簇聚类（identifyBadcases 自动触发）
- SkillOpt bounded edit + validation gate + rejected buffer
- 需求 Spec 自动生成
- 版本四象限（基线比较）
- **已实现**：Loop 运营分诊与验证闭环

### Phase 4：线上反馈与持续运营 🔄
- 线上 Trace 采集 + 回流（API 就绪，需业务系统对接）
- 生产 Replay Run（已实现，待脱敏数据源）
- Loop 周期化运营（页面已就绪）
- 多 Agent 泛化（架构支持，待接入第二 Agent）

## 10. 常见误区（开发时对照检查）

1. ❌ 只看最终答案 → ✅ 同时检查 Trace 过程
2. ❌ 用总分平均 P0 → ✅ P0 一票否决
3. ❌ 能规则判的交 LLM → ✅ 规则优先
4. ❌ Judge 不校准就进门禁 → ✅ 先校准到 85%
5. ❌ 整篇重写 Skill → ✅ Bounded edit
6. ❌ 强制分上线前/后两套系统 → ✅ 统一管道 + source 标签
7. ❌ 一次运行就做版本判断 → ✅ 重复运行 + 统计检验
8. ❌ 多模块同时修改 → ✅ 单一变量 + 归因
9. ❌ 不形成回归资产 → ✅ 每条 Badcase 生产质量资产
10. ❌ 离线提升就全量 → ✅ 灰度 + 线上验证
11. ❌ Bridge 靠 DOM 选择器模拟输入 → ✅ 被测页面暴露函数式 API（`window.__echoBridgeSubmit`），Bridge 直接调用
12. ❌ Bridge 并发 6 条一起跑 → ✅ 设 `BRIDGE_MAX_CONCURRENT=1` 单条测试，或逐步增加

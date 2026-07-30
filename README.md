# Agent 评测平台（Agent Eval Platform）

将 Agent 的"不稳定的智能行为"收敛为"可发布的工程质量"——一条贯穿研发、发布和运营的持续质量生产线。

---

## 是什么

一个可接入多类型 Agent 的**评测产品/平台**，提供上线前隔离跑测、上线后真实数据采集、统一标注、根因定位（RCA）与优化闭环（Loop / SkillOpt）能力。当前第一阶段聚焦 **Echo Agent**，架构已预留向其它 Agent 泛化。

### 解决什么问题

| 阶段 | 难题 | 本产品提供 |
|---|---|---|
| 上线前 | 评测集怎么建、怎么管、怎么真实跑 | 构建标准 + 评测集管理、Agent 真实接入（HTTP/Bridge）、隔离跑测、Trace 归一化 |
| 上线后 | 真实 session/trace 散乱、无法沉淀 | 线上 trace 采集（授权 + 脱敏 + 回放）、统一归一化格式 |
| 全周期 | 输出对不对、错在哪、怎么修 | 三层评分（规则 → LLM-as-Judge → 人工审核）+ RCA + Loop/SkillOpt 优化闭环 |

### 全链路闭环

```
质量契约 → 评测数据资产 → 隔离执行与 Trace 采集
  → 规则 / LLM Judge / 人工评分 → 门禁、报告与版本比较
  → Badcase 分诊、聚类、RCA → Skill 修复
  → 独立验证集接受或拒绝 → 灰度、监控、线上反馈
  └────────────────────────────────────────→ 回流为数据与回归资产
```

---

## 技术栈

- **全栈框架**：Next.js 16（App Router），React 19 + TypeScript
- **UI**：Ant Design 6 + Tailwind CSS 4 + Lucide React 图标
- **数据层**：Prisma 6 + SQLite（可迁移至 PostgreSQL）
- **评测数据**：YAML（用例、标准）+ JSON（Fixture）文件，Git 版本化
- **跑测调度**：独立 Worker 进程（`tsx scripts/eval-worker.ts`）
- **浏览器本地存储**：localforage（LLM Key 等设置）

---

## 快速开始

```bash
cd agent-eval-platform

# 1. 安装依赖 & 初始化数据库
npm install
npx prisma db push

# 2. 启动开发服务器（端口 3100）
npm run dev

# 3. 另开终端，启动跑测 Worker
npm run worker

# 4. （可选）评测 Echo 需要启动 Echo Bridge
cd echo-bridge
npm install
BRIDGE_MAX_CONCURRENT=1 npm start
```

浏览器打开 `http://localhost:3100`。

**前置条件：** 评测 Echo 时，需要画布前端 (`web/`) 也在 `localhost:3000` 运行，且已集成 Echo Bridge API（`echo-bridge-wrapper.tsx` + `canvas-assistant-panel.tsx` 中的 Bridge 注册 useEffect）。

---

## 核心功能

### 评测集与跑测

- **Agent 声明**：注册被测 Agent 的类型、风险等级与构建标准
- **接入配置**：支持三种执行协议——HTTP 同步、callback 异步（Bridge）、simulate 模拟
- **Echo Bridge**：独立 Playwright 进程，通过浏览器自动化驱动真实在线 Echo，直接调用 `CanvasAssistantPanel.sendMessage()`，不依赖 DOM 模拟。支持并发队列控制（`BRIDGE_MAX_CONCURRENT`）
- **评测集管理**：YAML 格式，支持 train / validation / test / regression / calibration 分层
- **批量跑测**：选择 Agent + 数据集 + 模式 → 一键发起 Run，Worker 自动执行 Trial
- **Trace 归一化**：以 OpenTelemetry GenAI / OpenInference 为基座，Echo Adapter 已就绪

### 评分与标注

- **三层评分**：规则评分器（确定性检查）→ LLM-as-Judge（语义判断）→ 人工审核（兜底）
- **评分路由**：规则粗筛 → 完整规则 + LLM Judge → 低置信/冲突/P0 抽检进入人工队列
- **多维度指标**：功能正确性、过程质量、鲁棒性与安全、效率与成本、产物与体验、Skill 专项

### 门禁与报告

- **P0/P1/P2 三级门禁**：P0 一票否决，P1 Wilson 下界阈值，P2 趋势观察
- **稳定性评测**：`pass@k`（能力上限）、`pass^k`（生产可靠性）
- **版本比较**：四象限（稳定通过/已修复/新增回归/持续失败）+ 统计检验
- **资源指标**：p50/p95 时延、Token 消耗、成本

### Badcase 与 RCA

- **自动识别**：`identifyBadcases()` 在每次跑测评分完成后自动触发
- **聚类**：按根因、场景、工具、Skill 聚合为问题簇
- **RCA 五步**：证据汇总 → 现象分类 → 候选模块缩圈 → 模块诊断 → 定责与行动

### Loop 运营与 SkillOpt

- **分诊**：规模 ≥ 阈值 → `needs-fix`；单条 → `observe`
- **需求 Spec**：自动生成修复需求规格
- **SkillOpt**：Bounded Edit（add/delete/replace）受控优化，独立 Validation Run 验证
- **Rejected Buffer**：被拒修改记录，防止重复尝试

### 线上采集与回放

- **Ingest API**：`POST /api/production/ingest`，HMAC 签名 + 脱敏校验
- **Replay Run**：授权 Trace 复制到隔离 Run 复测

---

## 目录结构

```
agent-eval-platform/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # 根布局（导航 + 主题）
│   ├── globals.css             # 全局样式
│   ├── page.tsx                # 仪表盘首页
│   ├── agents/                 # Agent 声明
│   ├── annotations/            # 标注查看
│   ├── badcases/               # Badcase + RCA
│   ├── connections/            # Agent 接入配置
│   ├── datasets/               # 评测集管理
│   ├── loops/                  # Loop 运营（分诊/Spec/验证）
│   ├── production/             # 线上采集与回放
│   ├── reports/                # 报告看板（门禁/统计/四象限）
│   ├── reviews/                # 人工审核队列
│   ├── runs/                   # 跑测中心
│   ├── settings/               # 设置（LLM Key 等）
│   ├── skillopt/               # SkillOpt 受控优化
│   ├── standards/              # 构建标准
│   ├── traces/                 # Trace 显化
│   └── api/                    # API Route Handlers（14 个端点）
├── src/
│   ├── adapters/               # Trace 归一化适配器（echo.ts）
│   ├── components/             # 共享 UI 组件
│   ├── execution/              # 执行器（http/callback/simulate）、编排、隔离、持久化
│   ├── lib/                    # 公共库（门禁、API 响应、Prisma、HMAC 验证等）
│   ├── ops/                    # Loop 运营逻辑
│   ├── rca/                    # RCA 五步 + Badcase 识别
│   ├── scorers/                # 规则评分器 + LLM Judge + 评分路由
│   ├── sim/                    # Echo 模拟执行器
│   ├── skillopt/               # SkillOpt（rollout/reflect/bounded-edit/validation-gate）
│   └── types/                  # TypeScript 类型定义
├── echo-bridge/                # Echo Bridge 浏览器 Harness（独立进程）
│   ├── server.ts               # Playwright 驱动 + HTTP API + 并发队列
│   ├── package.json
│   └── README.md
├── scripts/
│   ├── eval-worker.ts          # 跑测 Worker 主入口
│   └── ci-regression.mjs       # CI 回归脚本
├── datasets/echo/              # Echo 评测集（6 个 YAML 文件，按 split 分层）
├── standards/echo.yaml         # Echo 构建标准
├── fixtures/echo/              # 外部状态快照（画布初始状态等）
├── prisma/
│   ├── schema.prisma           # 数据库结构（15 张表）
│   └── migrations/             # 数据库迁移
├── docs/
│   ├── PRODUCT_SPEC.md         # 产品规格（唯一真源）
│   ├── DEVELOPMENT_SPEC.md     # 开发规范
│   ├── ACCEPTANCE_REPORT.md    # 验收报告
│   └── Agent-Skill评测方法论与指标体系.md
├── skills/                     # Skill 文件（SkillOpt 管理）
├── loops/                      # Loop 配置
└── package.json
```

---

## 数据模型

平台使用 Prisma + SQLite，核心实体关系：

```
Agent 1─* Dataset 1─* Run 1─* RunTrial 1─* TraceRecord 1─* Annotation
                                        └─1 Badcase ─1 RcaRecord
ProblemCluster 1─* Badcase
SkillOptRound、RejectedEdit 独立记录优化历史
ProductionIngestEvent 记录线上采集事件
```

评测用例正文以 YAML 存储在 `datasets/` 目录，Git 版本化；数据库仅保存运行数据、索引与工作流状态。

---

## 验收状态

**Phase 1–3 已通过端到端验收 ✅**（详见 `docs/ACCEPTANCE_REPORT.md`）

- 15 个页面全部可正常渲染和操作
- 全链路跑通：Agent 声明 → 接入 → 跑测 → Worker 执行 → 评分 → 门禁 → 报告 → Badcase/RCA
- Simulate 模式 2 Case × 3 repeat = 6 Trial，gatePassed=true，P0 违规=0
- **Echo Bridge**：callback 协议已实现，Playwright 驱动真实在线 Echo，端到端链路已验证
- Phase 4（线上采集/回放 API）已就绪，灰度联动待线上部署验证

---

## 约束与注意事项

- 所有文件在 `agent-eval-platform/` 内，不修改仓库中其它现有文件
- 对 Echo 的接入为**旁路采集/评测**，不破坏 Echo/CodeX/Hermes 三 Agent 的连接隔离
- 模拟模式（`simulate`）仅用于演示与本地开发，不可作为真实能力验证结果
- LLM Judge 未配置 Key 时优雅降级为 `skipped`，不阻塞规则评分
- Worker 单进程顺序执行 Trial，避免 SQLite 并发写锁
- **Echo Bridge**：
  - Bridge 是独立进程，需在评测 Echo 前单独启动
  - 建议 `BRIDGE_MAX_CONCURRENT=1` 进行单条测试，避免多个 Playwright page 竞争画布资源
  - 需要画布前端 (`web/`) 在 `localhost:3000` 运行，且已集成 Bridge API
  - Bridge 不通过 DOM 模拟操作，而是直接调用 `CanvasAssistantPanel` 暴露的真实函数

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/PRODUCT_SPEC.md](./docs/PRODUCT_SPEC.md) | 产品规格（唯一真源）：定位、数据模型、评分、门禁、RCA、SkillOpt |
| [docs/DEVELOPMENT_SPEC.md](./docs/DEVELOPMENT_SPEC.md) | 开发规范：目录结构、分层职责、分阶段路线 |
| [docs/ACCEPTANCE_REPORT.md](./docs/ACCEPTANCE_REPORT.md) | 验收测试报告：Playwright + API E2E 验证结果 |
| [docs/Agent-Skill评测方法论与指标体系.md](./docs/Agent-Skill评测方法论与指标体系.md) | 方法论基座：指标体系与评测方法详述 |

# RFC-0004：Echo Agent 评测方法论

**status**: draft

> 本文为调研/提案、非强制规范。本文档定义 EchoDrama 项目中 Echo Agent 的评测方法论，
> 包括评测数据集建设、评测流程设计、评分体系、根因分析与优化闭环。

---

## 一、背景与目标

### 1.1 为什么需要体系化评测

Echo Agent 是 EchoDrama 画布中的核心 AI 助手，负责理解用户意图并操作画布（创建节点、
生成内容、编排剧情等）。与传统软件不同，Agent 面临三大挑战：

- **非确定性**：相同输入可能产生不同输出（不同模型、不同工具选择路径）
- **黑盒化**：内部决策过程（为什么选这个工具、为什么用这个参数）不透明
- **错误级联放大**：前期工具调用的微小偏差可能在后续步骤中被放大

本项目上线前，必须建立一套覆盖"数据集可查看、可收集、可管理"的完整评测体系，
将"不稳定的智能行为"收敛为"可发布的工程质量"。

### 1.2 评测目标

1. **发布门禁**：每次发版前，核心评测集通过率必须达标
2. **回归检测**：Agent Prompt 或工具定义变更后，自动检测行为退化
3. **问题定位**：将失败案例稳定地追溯到责任模块和可修复原因
4. **持续优化**：将线上失败持续转化为可复用的研发资产（评测用例、Prompt 优化、工具改进）

---

## 二、Echo Agent 能力画像

### 2.1 Agent 架构概览

Echo Agent 是三个画布 Agent 之一（Echo / CodeX / Hermes），特点如下：

| 维度 | 说明 |
|------|------|
| **模式** | `online` — 浏览器直连模型厂商 API |
| **请求链路** | 浏览器 → 模型厂商（Responses API / Chat Completions API）→ 工具调用循环 |
| **画布操作** | 浏览器本地 `onApplyOps` 直接修改画布，无需中间服务 |
| **MCP 工具** | 注册 `infinite-canvas` MCP Server，共 23 个工具 |
| **模型** | 用户自行配置的文本模型（通过 API Key 直连） |

### 2.2 核心能力矩阵

Echo Agent 的能力覆盖以下维度，每个维度都是评测的重点：

#### 工具调用能力（23 个 MCP 工具）

| 类别 | 工具 | 评测重点 |
|------|------|----------|
| **读取** | `canvas_get_state`, `canvas_get_selection`, `canvas_export_snapshot` | 能否正确理解画布当前状态 |
| **创建节点** | `canvas_create_node`, `canvas_create_text_node`, `canvas_create_text_nodes`, `canvas_create_config_node`, `canvas_create_image_prompt_flow` | 节点类型选择、参数填充是否正确 |
| **生成流程** | `canvas_create_generation_flow`, `canvas_generate_text`, `canvas_generate_image`, `canvas_generate_video`, `canvas_generate_audio`, `canvas_run_generation` | 生成配置是否正确、节点连线是否合理 |
| **编辑节点** | `canvas_update_node`, `canvas_update_node_text`, `canvas_move_nodes`, `canvas_resize_node`, `canvas_delete_nodes` | 编辑操作是否精确、是否误伤其他节点 |
| **连线视口** | `canvas_connect_nodes`, `canvas_select_nodes`, `canvas_set_viewport` | 连线 kind/outcomeId 是否正确 |
| **批量操作** | `canvas_apply_ops` | 批量操作的原子性、顺序是否正确 |

#### 画布类型适配

| 画布类型 | 可用节点类型 | 评测重点 |
|----------|-------------|----------|
| **Content（内容生产）** | text, image, config, video, audio, plugin:* | 不创建 Story/Game 节点（安全约束） |
| **Story（编排）** | Content 全部 + story-chapter, story, story-choice, story-checkpoint, story-attribute, story-attribute-gate, game | 连线 kind（flow/story-choice/game-outcome）正确 |

#### 生成能力

| 生成类型 | 关键参数 | 评测重点 |
|----------|----------|----------|
| **文本生成** | model, prompt | 内容质量、格式正确 |
| **图片生成** | model, size, quality, count | 参考图引用正确、参数合理 |
| **视频生成** | model, seconds, vquality | 时长参数、节点配置 |
| **音频生成** | model, seconds, voice | 音色、格式参数 |

#### 安全约束

- Content 画布中拒绝创建 Story/Game 节点（硬拦截）
- Content 画布中拒绝运行态连线（kind="flow"/"story-choice"/"game-outcome"）
- 插件节点需注册表校验，未启用时明确拒绝

---

## 三、评测维度与指标体系

### 3.1 五维评测框架

结合项目 Agent 特点，定义以下五个评测维度：

| 维度 | 权重 | 说明 |
|------|------|------|
| **工具选择准确率** | 30% | 针对用户意图，是否正确选择了工具（类型、参数） |
| **任务完成度** | 30% | 用户请求是否被完整、正确地执行 |
| **画布操作正确性** | 20% | 创建/编辑/删除节点和连线的结果是否符合预期 |
| **安全约束合规** | 10% | 是否遵守画布类型隔离、插件校验等安全规则 |
| **效率与成本** | 10% | 工具调用次数、Token 消耗、操作步骤是否精简 |

### 3.2 指标体系分级

| 级别 | 定义 | 用途 | Echo Agent 示例 |
|------|------|------|----------------|
| **P0** | 上线门禁，不达标不能发布 | 核心场景回归 | 单节点创建成功率 ≥ 95%；安全约束违规率 = 0 |
| **P1** | 版本比较和工程优化 | 能力退化检测 | 工具选择准确率不低于上一版本；生成流程成功率 |
| **P2** | 体验改善和长期观察 | 渐进优化 | 平均工具调用步数、Token 消耗趋势、用户满意度 |

### 3.3 关键指标定义

#### 工具选择准确率（Tool Selection Accuracy）

```
TSA = 正确选择工具并填充正确参数的用例数 / 总用例数
```

- 子指标：
  - 工具类型正确率：选的工具对不对
  - 参数正确率：工具参数填充是否准确
  - 多余工具调用率：是否调用了不必要的工具

#### 任务完成度（Task Completion Rate）

```
TCR = Σ(单用例完成度分数) / 总用例数

单用例评分：
- 1.0：完全按预期完成
- 0.7：主要目标达成，有小瑕疵
- 0.4：部分完成，但关键步骤有误
- 0.0：完全失败或产生错误结果
```

#### 安全约束合规率（Safety Compliance Rate）

```
SCR = 通过安全约束检查的用例数 / 总用例数

检查项：
- Content 画布中是否误创建 Story/Game 节点
- Content 画布中是否使用运行态连线 kind
- 是否在画布外进行未授权操作
```

#### 连续成功率（Consecutive Success Rate）

```
CSR = N 次重复执行中全部成功的比例
```

由于 Agent 的非确定性，单次成功率不足以衡量稳定性。
对于 P0 级场景，要求 N≥3 次重复执行中至少 N-1 次成功。

---

## 四、评测数据集建设

### 4.1 数据集架构总览

评测数据集采用分层架构，确保"可查看、可收集、可管理"：

```
eval-datasets/
├── golden/                 # 黄金评测集（P0 门禁）
│   ├── content/            # Content 画布场景
│   │   ├── node-creation/  # 节点创建类
│   │   ├── generation/     # 内容生成类
│   │   ├── editing/        # 编辑操作类
│   │   └── safety/         # 安全约束类
│   ├── story/              # Story 画布场景
│   │   ├── chapter-flow/   # 章节编排类
│   │   ├── choice-branch/  # 选择分支类
│   │   ├── attribute-gate/ # 属性门禁类
│   │   └── game-node/      # 游戏节点类
│   └── cross-canvas/       # 跨画布场景
├── expanded/               # 扩展评测集（P1 回归）
│   ├── llm-generated/      # LLM 生成的变体用例
│   └── edge-cases/         # 边界场景
├── production/             # 线上采集集（持续更新）
│   ├── real-sessions/      # 真实用户会话
│   └── badcase-archive/    # Badcase 回流
└── meta/                   # 数据集元信息
    ├── schema.yaml         # 用例格式定义
    └── tags.yaml           # 标签体系
```

### 4.2 用例格式定义

每条评测用例采用统一的 YAML 格式：

```yaml
# eval-datasets/meta/schema.yaml
id: "eval-001"                    # 唯一标识
title: "创建单个文本节点"           # 用例标题
description: "用户要求创建一个包含指定内容的文本节点"
category: "node-creation"         # 分类
tags: ["text-node", "single", "basic"]
priority: P0                      # P0 / P1 / P2

# 前置条件
precondition:
  canvasType: "content"           # content / story
  initialState:                   # 画布初始状态（节点列表）
    nodes: []
    connections: []

# 用户输入
input:
  type: "text"                    # text / multi-turn
  message: "帮我创建一个文本节点，标题是'角色设定'，内容是'一个勇敢的骑士'"

# 期望行为
expected:
  # 工具调用期望
  toolCalls:
    - tool: "canvas_create_text_node"  # 或 "canvas_create_node"
      params:
        title: "角色设定"
        content: "一个勇敢的骑士"
        # 可选：使用正则匹配
        # content: { $regex: "勇敢的骑士" }

  # 画布状态期望
  canvasState:
    nodeCount: 1
    nodes:
      - type: "text"
        title: "角色设定"
        contentContains: "勇敢的骑士"

  # 安全约束期望
  safety:
    noStoryNodesInContent: true
    noRuntimeConnectionsInContent: true

# 评分规则
judge:
  strategy: "hybrid"              # rule / llm / hybrid
  rules:
    - type: "tool_call_match"     # 工具调用匹配
    - type: "canvas_state_check"  # 画布状态检查
    - type: "safety_check"        # 安全检查
  llmJudge:
    enabled: false                # 简单用例不需要 LLM Judge
    criteria: []
```

### 4.3 数据集来源

#### 4.3.1 专家设计用例（Golden Set）

由熟悉 Echo Agent 能力和画布操作的开发者手工设计，覆盖：

1. **节点创建类（~30 条）**
   - 单节点创建：text / image / config / video / audio
   - 批量节点创建：多文本节点、带布局参数
   - 插件节点创建：sticky-note / markdown / panorama
   - 带参数创建：指定 position、size、metadata

2. **内容生成类（~20 条）**
   - 文本生成流程：prompt → config → 生成
   - 图片生成流程：含参考图、指定模型和尺寸
   - 视频生成流程：指定时长和质量
   - 音频生成流程：指定音色和格式
   - 复合生成：同时创建多个生成流程

3. **编辑操作类（~15 条）**
   - 更新节点内容
   - 移动节点位置
   - 调整节点尺寸
   - 删除节点
   - 连接/断开连线

4. **安全约束类（~10 条）**
   - Content 画布中尝试创建 Story 节点 → 应拒绝
   - Content 画布中尝试使用运行态连线 → 应拒绝
   - 插件节点被禁用时尝试创建 → 应拒绝
   - 正确识别画布类型并切换行为

5. **Story 编排类（~25 条）**
   - 创建章节节点并连线
   - 创建剧情节点并填写 metadata
   - 创建选择分支节点（storyChoices）
   - 创建属性定义和门禁节点
   - 创建游戏节点（各 gameplayId）
   - 正确使用连线 kind（flow / story-choice / game-outcome）

**Golden Set 规模：约 100 条**

#### 4.3.2 LLM 扩展用例

基于 Golden Set 的结构，使用 LLM 生成语义变体：

- 同义改写用户输入（不同的自然语言表达）
- 参数变体（不同的位置、尺寸、内容）
- 边界情况（极长文本、特殊字符、空输入）

**扩展规模：约 200-300 条**

#### 4.3.3 线上真实数据采集

在画布中内置评测数据采集机制（通过 `canvas-agent-task.ts` 和 `canvas-agent-ops.ts` 中的
Agent 操作日志）：

```typescript
// 采集 Agent 操作的完整 trace
interface AgentTrace {
  sessionId: string;
  userMessage: string;
  toolCalls: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: unknown;
    timestamp: number;
  }>;
  canvasStateBefore: CanvasSnapshot;
  canvasStateAfter: CanvasSnapshot;
  timestamp: number;
}
```

数据采集原则：
- 用户可选择是否参与数据采集（opt-in）
- 采集数据匿名化处理（去除用户身份信息）
- 定期（每周）从采集数据中筛选高质量样本加入评测集

#### 4.3.4 Badcase 回流

将以下来源的失败案例自动加入 Badcase 归档：

1. 用户反馈（"不满意"按钮 / 撤销操作）
2. Agent 操作被安全约束拒绝的记录
3. 生成结果被用户删除后重新生成的情况

每条 Badcase 记录：
```yaml
id: "badcase-001"
source: "user-feedback"          # user-feedback / safety-rejection / regeneration
originalSessionId: "sess-xxx"
userIntent: "创建一个剧情分支"
actualBehavior: "在 Content 画布中尝试创建 Story 节点被拒绝"
rootCause: "Agent 未先检查画布类型"
fixAction: "Prompt 中强调先调用 canvas_get_state 检查 canvasType"
status: "pending-fix"            # pending-fix / fixed / verified
```

---

## 五、评分体系

### 5.1 三层评分策略

遵循"规则为主 → LLM Judge 为辅 → 人工兜底"的策略：

```
┌─────────────────────────────────────┐
│  Layer 1: 规则评分（覆盖 80%）        │
│  - 工具调用类型匹配                    │
│  - 参数精确/模糊匹配                   │
│  - 画布状态断言                       │
│  - 安全约束检查                       │
│  成本：$0，速度：毫秒级                │
└──────────────┬──────────────────────┘
               │ 规则无法判定
               ▼
┌─────────────────────────────────────┐
│  Layer 2: LLM Judge（覆盖 15%）       │
│  - 语义合理性判断                     │
│  - 多方案质量对比                     │
│  - 内容质量评分                       │
│  成本：低，速度：秒级                  │
└──────────────┬──────────────────────┘
               │ 争议 / 高风险
               ▼
┌─────────────────────────────────────┐
│  Layer 3: 人工复核（覆盖 5%）          │
│  - 新建评测集时确认标准                │
│  - LLM Judge 校准                    │
│  - 高风险场景终审                     │
│  成本：高，速度：分钟级                │
└─────────────────────────────────────┘
```

### 5.2 规则评分器

#### 工具调用匹配规则

```typescript
interface ToolCallRule {
  type: "tool_call_match";
  tool: string;                              // 期望的工具名
  params?: Record<string, ParamMatcher>;     // 参数匹配规则
}

type ParamMatcher =
  | { $eq: unknown }          // 精确匹配
  | { $regex: string }        // 正则匹配
  | { $contains: string }     // 包含匹配
  | { $type: string }         // 类型匹配
  | { $oneOf: unknown[] };    // 枚举匹配
```

#### 画布状态断言

```typescript
interface CanvasStateAssertion {
  type: "canvas_state_check";
  checks: Array<
    | { nodeCount: { $eq: number } }
    | { nodeCount: { $gte: number } }
    | { nodes: Array<NodeAssertion> }
    | { connections: Array<ConnectionAssertion> }
  >;
}

interface NodeAssertion {
  type?: string;
  title?: ParamMatcher;
  contentContains?: string;
  metadata?: Record<string, ParamMatcher>;
  position?: { x?: number; y?: number };
}
```

#### 安全约束检查

```typescript
interface SafetyCheck {
  type: "safety_check";
  rules: Array<
    | "noStoryNodesInContent"
    | "noRuntimeConnectionsInContent"
    | "noDisabledPluginCreation"
    | "canvasTypeAwareness"
  >;
}
```

### 5.3 LLM Judge

用于规则无法判定的场景（如"生成的内容是否符合创意要求"、"多方案中哪个更优"）：

```yaml
llmJudge:
  model: "gpt-4o"              # 评审模型
  criteria:
    - name: "内容相关性"
      description: "生成内容是否与用户请求相关"
      scale: [1, 2, 3, 4, 5]
    - name: "操作合理性"
      description: "Agent 操作步骤是否合理、高效"
      scale: [1, 2, 3, 4, 5]
    - name: "创意质量"
      description: "生成内容是否具有创意价值"
      scale: [1, 2, 3, 4, 5]
  fewShotExamples: 3           # Few-shot 示例数量
  calibrationInterval: "weekly" # 校准频率
```

LLM Judge 校准机制：
- 每周从人工复核的用例中抽取 10 条，与 LLM Judge 评分对比
- 评分一致性低于 80% 时触发校准（更新 Few-shot 示例或调整 criteria）
- 高方差用例（标准差 > 1.0）自动升级为人工复核

---

## 六、根因分析（RCA）与优化闭环

### 6.1 根因定位流程

参考文章中的 RCA 方法，定义 Echo Agent 的根因定位链路：

```
失败用例
  │
  ▼
┌─────────────────────────────────────┐
│ Step 1: 证据汇总                     │
│ - 用户输入                           │
│ - Agent 完整 tool_call 轨迹          │
│ - 画布状态快照（操作前后）             │
│ - 模型原始响应                       │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step 2: 范围收敛                     │
│ - 问题现象 → 功能模块映射             │
│   例：选择了错误的工具类型 → 工具选择   │
│   例：参数填充不完整 → 参数理解        │
│   例：画布类型误判 → 上下文理解        │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step 3: 分模块诊断                   │
│                                     │
│ A. 工具选择诊断                      │
│   - 检查 tool_choice 是否正确        │
│   - 检查是否有更适合的工具被忽略       │
│                                     │
│ B. 参数理解诊断                      │
│   - 检查参数是否从用户输入正确提取     │
│   - 检查默认值使用是否合理            │
│                                     │
│ C. 上下文理解诊断                     │
│   - 检查 canvas_get_state 是否被调用  │
│   - 检查画布类型（canvasType）是否正确 │
│   - 检查历史对话上下文是否被正确使用    │
│                                     │
│ D. 安全约束诊断                      │
│   - 检查安全规则是否触发              │
│   - 区分"Agent 不知道规则"和"Agent 忽略规则" │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step 4: 责任判定 + 修复建议          │
│                                     │
│ 责任模块：                           │
│ - Agent Prompt（提示词问题）          │
│ - 工具 Schema（工具定义问题）          │
│ - 安全规则（约束规则问题）             │
│ - 模型能力（模型自身限制）             │
│                                     │
│ 修复动作：                           │
│ - Prompt 增强：添加约束说明           │
│ - Schema 优化：调整工具描述/参数       │
│ - 规则调整：放宽/收紧安全规则          │
│ - 模型切换：换用更强的模型             │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step 5: 结构化落盘 + 回流             │
│ - 写入 badcase-archive               │
│ - 生成回归用例                        │
│ - 更新 Golden Set（如需要）           │
└─────────────────────────────────────┘
```

### 6.2 问题现象 → 功能模块映射表

| 问题现象 | 可能模块 | 排查优先级 |
|----------|----------|-----------|
| 创建了错误类型的节点 | 工具选择 / Prompt | Prompt > 工具 Schema |
| 参数缺失或错误 | 参数理解 / 工具 Schema | 工具 Schema > 参数理解 |
| 在 Content 画布创建 Story 节点 | 上下文理解 / 安全规则 | 上下文理解 > 安全规则 |
| 连线 kind 不正确 | 工具选择 / Prompt | Prompt > 工具选择 |
| 生成配置参数不合理 | 参数理解 / 模型能力 | 参数理解 > 模型能力 |
| 批量操作遗漏节点 | 上下文理解 / 模型能力 | 上下文理解 > 模型能力 |
| 多余的工具调用 | Prompt / 模型能力 | Prompt > 模型能力 |
| 画布状态误读 | 上下文理解 | 上下文理解 |

### 6.3 优化闭环

```
                ┌──────────┐
                │ 评测执行  │
                └─────┬────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      ┌──────┐   ┌──────┐   ┌──────┐
      │ 通过  │   │ 失败  │   │ 争议  │
      └──┬───┘   └──┬───┘   └──┬───┘
         │          │          │
         │    ┌─────▼─────┐    │
         │    │ 根因分析   │    │
         │    └─────┬─────┘    │
         │          │          │
         │    ┌─────▼─────┐    │
         │    │ 人工确认   │◄───┘
         │    └─────┬─────┘
         │          │
         │    ┌─────▼─────────────────────┐
         │    │ 产出修复动作               │
         │    │ - Prompt 优化              │
         │    │ - 工具 Schema 调整         │
         │    │ - 安全规则更新             │
         │    │ - 模型配置变更             │
         │    │ - 新增回归用例             │
         │    └─────┬─────────────────────┘
         │          │
         │    ┌─────▼─────┐
         │    │ 回归验证   │
         │    └─────┬─────┘
         │          │
         └──────────┼──────────┐
                    ▼          │
              ┌──────────┐    │
              │ 通过门禁  │    │
              └──────────┘    │
                              │
              ┌───────────────┘
              ▼
        ┌──────────┐
        │ 持续迭代  │
        └──────────┘
```

### 6.4 修复动作模板

每条根因分析产出结构化的修复动作：

```yaml
fixAction:
  id: "fix-001"
  title: "增强 Content 画布类型检查提示"
  module: "Agent Prompt"
  type: "prompt-enhancement"   # prompt-enhancement / schema-update / rule-change / model-change
  owner: "agent-team"
  priority: P0
  description: |
    在 Agent Prompt 中增加强制步骤：任何节点创建前必须先调用 canvas_get_state
    检查 canvasType，如果 canvasType === "content" 且用户请求创建 Story 节点，
    必须提示用户切换到 Story 画布。
  changes:
    - file: "canvas-agent/src/config.ts"
      section: "AGENT_PROMPT"
      diff: |
        + 在执行任何节点创建操作前，你必须先调用 canvas_get_state 获取当前画布的 canvasType。
        + - 如果 canvasType 是 "content" 且用户请求的是编排节点（story-chapter/story/story-choice/
        +   story-checkpoint/story-attribute/story-attribute-gate/game），你必须提示用户：
        +   "当前是内容生产画布，无法创建编排节点。请切换到编排画布（Story）后再试。"
        + - 不要尝试在 content 画布中创建这些节点。
  verification:
    testCases: ["eval-040", "eval-041", "eval-042"]
    expectedResult: "安全约束违规率降至 0"
```

---

## 七、评测流程与 CI 集成

### 7.1 评测执行流程

```
┌──────────────────────────────────────────────────────┐
│                    评测执行流水线                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. 加载评测数据集                                      │
│     └─ golden/ → expanded/ → production/              │
│                                                      │
│  2. 初始化画布环境                                      │
│     └─ 启动 Headless Browser + 画布实例                │
│                                                      │
│  3. 逐条执行用例                                        │
│     ├─ 设置前置条件（画布初始状态）                       │
│     ├─ 发送用户输入                                     │
│     ├─ 收集 Agent 响应和 tool_call 轨迹                 │
│     ├─ 对比画布状态                                     │
│     └─ 执行评分规则                                     │
│                                                      │
│  4. 生成评测报告                                        │
│     ├─ 通过率 / 失败率                                  │
│     ├─ 分维度得分                                       │
│     ├─ 失败用例详情（含 trace）                          │
│     └─ 根因分析建议                                     │
│                                                      │
│  5. 门禁判断                                           │
│     ├─ P0 指标达标 → 允许发布                           │
│     └─ P0 指标不达标 → 阻断发布                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 7.2 CI 集成

将评测集成到项目的 CI/CD 流水线中：

```yaml
# .github/workflows/agent-eval.yml (示意)
name: Echo Agent Evaluation

on:
  pull_request:
    paths:
      - "canvas-agent/src/config.ts"    # Agent Prompt 变更
      - "canvas-agent/src/schemas.ts"   # 工具 Schema 变更
      - "canvas-agent/src/tools.ts"     # 工具实现变更
  push:
    branches: [main]                    # 合入主干时全量评测

jobs:
  golden-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Eval Environment
        run: |
          # 安装评测依赖
          # 启动画布测试实例
      - name: Run Golden Set
        run: |
          # 执行 golden/ 目录下所有 P0 用例
      - name: Check Gate
        run: |
          # 检查 P0 门禁指标
          # TSA >= 95% && SCR == 100% && TCR >= 90%

  regression-eval:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Run Full Evaluation
        run: |
          # 执行 golden/ + expanded/ 全部用例
          # 生成完整评测报告
      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: eval-report
          path: eval-results/
```

### 7.3 评测报告格式

```yaml
# eval-results/report-{timestamp}.yaml
summary:
  totalCases: 100
  passed: 92
  failed: 6
  skipped: 2
  passRate: 0.92

  byPriority:
    P0:
      total: 40
      passed: 40
      passRate: 1.0
    P1:
      total: 40
      passed: 36
      passRate: 0.9
    P2:
      total: 20
      passed: 16
      passRate: 0.8

  byDimension:
    toolSelectionAccuracy: 0.94
    taskCompletionRate: 0.91
    canvasOperationCorrectness: 0.93
    safetyComplianceRate: 1.0
    efficiencyScore: 0.88

  gateCheck:
    P0_toolSelectionAccuracy: { required: 0.95, actual: 0.96, passed: true }
    P0_safetyComplianceRate: { required: 1.0, actual: 1.0, passed: true }
    P0_taskCompletionRate: { required: 0.90, actual: 0.92, passed: true }
    overall: PASSED

failedCases:
  - id: "eval-025"
    title: "创建复杂生成流程"
    failureType: "tool_selection"
    rootCause: "Agent 选择了 canvas_create_node 而非 canvas_create_generation_flow"
    suggestedFix: "Prompt 中增加场景引导"
    trace: "traces/eval-025.json"

  - id: "eval-056"
    title: "Story 画布创建选择分支"
    failureType: "parameter_error"
    rootCause: "storyChoices 中 nextNodeId 引用了不存在的节点"
    suggestedFix: "工具 Schema 中增加节点存在性校验说明"
    trace: "traces/eval-056.json"
```

---

## 八、数据管理平台

### 8.1 核心需求

评测数据集的"可查看、可收集、可管理"通过以下机制实现：

#### 可查看

- 所有评测数据集以 YAML 文件形式存储在 `eval-datasets/` 目录下
- 每条用例包含完整的输入、期望输出、评分规则
- 评测报告可视化展示（HTML Dashboard）
- 失败用例可下钻查看完整 Agent trace

#### 可收集

- 画布中内嵌 Agent 操作日志采集
- 用户反馈（👍/👎）自动关联到对应 Agent trace
- 安全约束拒绝记录自动归档
- 定期从采集数据中筛选高质量样本加入评测集

#### 可管理

- 评测集版本化管理（Git 跟踪）
- 用例状态管理：draft → review → active → deprecated
- 标签体系：按画布类型、节点类型、能力维度多维度分类
- Badcase 状态追踪：pending-fix → fixed → verified
- 定期清理：每季度审查，移除过时或不再适用的用例

### 8.2 管理界面设计

建议在项目文档站点（`/docs`）或独立管理页面中提供：

- **数据集浏览**：按分类、标签、优先级筛选查看所有用例
- **评测历史**：查看历次评测结果和趋势图
- **Badcase 看板**：展示待修复/已修复/已验证的 Badcase
- **用例编辑器**：在线编辑/新增评测用例

---

## 九、实施路线图

### Phase 1：基础建设（第 1-2 周）

| 任务 | 产出 |
|------|------|
| 定义用例格式规范（YAML Schema） | `eval-datasets/meta/schema.yaml` |
| 编写 Golden Set 前 50 条用例 | `eval-datasets/golden/` |
| 实现基础评分器（规则评分） | 评分引擎代码 |
| 搭建评测执行脚本 | 一键运行脚本 |
| 定义 CI 门禁规则 | CI 配置文件 |

### Phase 2：体系完善（第 3-4 周）

| 任务 | 产出 |
|------|------|
| Golden Set 扩展至 100 条 | 完整 P0 用例集 |
| LLM 扩展用例生成（200+ 条） | `eval-datasets/expanded/` |
| LLM Judge 评分器实现 | 语义评分能力 |
| 评测报告可视化 | HTML Dashboard |
| CI 集成完成 | PR 自动触发评测 |

### Phase 3：持续运营（上线后）

| 任务 | 产出 |
|------|------|
| 线上数据采集机制上线 | 自动采集 Agent trace |
| Badcase 回流流程建立 | 自动归档 + 人工筛选 |
| 每周评测执行 + 根因分析 | 评测周报 |
| 每月数据集审查更新 | 数据集质量维护 |
| Prompt/Schema 持续优化 | 基于评测结果迭代 |

---

## 十、关键参考

### 10.1 外部参考

1. **Agent 评测：方法论与体系设计** — 阿里技术（孙敦灿，2026-07）
   - 核心贡献：评测体系设计、指标分级（P0/P1/P2）、RCA 根因分析流程、全链路闭环
2. **skill-up：让 Agent Skill 可评测可回归** — 阿里技术（李斌，2026-07）
   - 核心贡献：声明式评测配置、分层判定（expect + judge）、多引擎支持、CI 友好
3. **LLM Agent 效果评估完整方法论** — 酥悠沫大模型评测（2025-11）
   - 核心贡献：三层评估框架、工具使用四级演进、条件成功率（CSR）、分层评估策略
4. **Agent 评测体系深度解析** — 掘金社区（2025-11）
   - 核心贡献：四大核心能力评测维度、主流工具对比、评测工具生态
5. **Berkeley Function Calling Leaderboard (BFCL)** — UC Berkeley
   - 核心贡献：函数调用评测标准、多轮工具调用评测方法
6. **Survey on Evaluation of LLM-based Agents** (arxiv 2503.16416)
7. **Evaluation and Benchmarking of LLM Agents: A Survey** (KDD 2025, arxiv 2507.21504)

### 10.2 项目内部参考

- `canvas-agent/src/config.ts` — Echo Agent Prompt 定义
- `canvas-agent/src/schemas.ts` — 23 个 MCP 工具定义
- `web/src/app/(user)/canvas/utils/canvas-node-registry.ts` — 节点注册表
- `web/src/app/(user)/canvas/utils/canvas-agent-ops.ts` — Agent 操作执行引擎
- `docs/content/docs/backend/agent-connection-isolation.mdx` — 三 Agent 隔离规范

---

## 十一、附录：场景分类完整清单

### A. Content 画布评测场景

| 场景分类 | 子场景 | 预估用例数 | 优先级 |
|----------|--------|-----------|--------|
| 节点创建 | 单文本节点 | 5 | P0 |
| 节点创建 | 单图片节点 | 3 | P0 |
| 节点创建 | 单配置节点 | 5 | P0 |
| 节点创建 | 单视频/音频节点 | 3 | P1 |
| 节点创建 | 批量文本节点 | 3 | P0 |
| 节点创建 | 插件节点 | 3 | P1 |
| 内容生成 | 文本生成流程 | 5 | P0 |
| 内容生成 | 图片生成流程 | 5 | P0 |
| 内容生成 | 视频生成流程 | 3 | P1 |
| 内容生成 | 音频生成流程 | 3 | P1 |
| 内容生成 | 复合生成（含参考图） | 4 | P1 |
| 编辑操作 | 更新节点内容 | 5 | P0 |
| 编辑操作 | 移动/调整节点 | 3 | P1 |
| 编辑操作 | 删除节点 | 3 | P0 |
| 编辑操作 | 连线操作 | 3 | P1 |
| 安全约束 | Content 拒绝 Story 节点 | 5 | P0 |
| 安全约束 | Content 拒绝运行态连线 | 3 | P0 |
| 安全约束 | 插件节点校验 | 2 | P1 |

### B. Story 画布评测场景

| 场景分类 | 子场景 | 预估用例数 | 优先级 |
|----------|--------|-----------|--------|
| 章节编排 | 创建章节节点 | 3 | P0 |
| 章节编排 | 创建剧情节点 | 3 | P0 |
| 章节编排 | 章节→剧情连线（flow） | 3 | P0 |
| 选择分支 | 创建选择节点 | 5 | P0 |
| 选择分支 | 选项连线（story-choice） | 5 | P0 |
| 属性系统 | 创建属性定义 | 3 | P1 |
| 属性系统 | 创建属性门禁 | 3 | P1 |
| 属性系统 | 门禁分支连线 | 3 | P1 |
| 游戏节点 | 各 gameplayId 创建 | 6 | P1 |
| 游戏节点 | 游戏结局连线（game-outcome） | 3 | P1 |
| 复合编排 | 完整剧情流程 | 5 | P0 |

### C. 跨画布评测场景

| 场景分类 | 子场景 | 预估用例数 | 优先级 |
|----------|--------|-----------|--------|
| 画布识别 | Agent 正确识别 canvasType | 3 | P0 |
| 画布切换 | 用户切换画布后行为正确 | 3 | P1 |
| 混合操作 | Content 中创建内容 + Story 中编排 | 2 | P1 |

**总计预估用例数：约 100-120 条（Golden Set）**

---

> **本文状态**：draft — 待团队评审和确认后进入实施阶段。
> 评测数据集的具体文件结构和代码实现将作为后续 RFC 或直接进入 `progress/todo.mdx`。

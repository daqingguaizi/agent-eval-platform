---
name: quality-contract-author
description: 质量契约撰写 Skill。当用户需要为一个"被测 Agent / Skill"定义评测的质量契约（Quality Contract）时使用。用户提供被测对象的资料（产品/开发 SPEC、README、系统提示词、工程代码、能力说明等），本 Skill 严格按统一契约模板产出一份结构化、可评审、可溯源的质量契约（YAML + 说明书），作为后续评测集生成、评分器配置、发布门禁的唯一派生源头。触发词：质量契约、评测契约、quality contract、被测 agent 契约、评测标准定义、standards.yaml。
license: 内部使用
---

# 质量契约撰写 Skill（Quality Contract Author）

本 Skill 指导你把一个「被测 Agent / Skill」的资料，转化为一份**统一格式、可评审、可溯源**的**质量契约**。这份契约是后续所有评测步骤（数据集生成、评分器配置、发布门禁）的**唯一派生源头**——评测不再从"人手写用例和规则"开始，而是从这份契约开始。

> **上位方法论**：`agent-eval-platform/docs/Agent-Skill评测方法论与指标体系.md` 第 4 节「定义质量契约」。
> **通用性**：本 Skill 面向**任意类型**的被测对象（对话 / 知识问答 / 工具执行 / 诊断决策 / 代码 / 创意生成 等），按识别出的类型选择性填充字段，不为单一 Agent 定制。

---

## 0. 最重要的三条铁律（违反即视为失败）

> 这三条约束的目的是：**保证每份契约质量统一、可信、可溯源，杜绝 AI 自由发挥。**

### 铁律一：绝不臆造（No Fabrication）

契约里的**每一条内容**都必须来自用户提供的资料，且能指向具体来源（文件/段落/原话）。

- 资料里**明确写了**的 → 写入契约，并在 `sourceRefs` 标注来源。
- 资料里**没有、或不确定**的 → **绝对不许猜测、不许"合理推断"、不许用行业常识补全**。必须走「铁律二/三」的返回机制。
- 严禁出现"看起来像那么回事，但资料里根本没有依据"的字段值。

### 铁律二：必填字段缺失 → 停止产出，返回用户补充

契约有一批**必填字段**（见第 3 节标记 `【必填】`）。只要有任何一个必填字段无法从资料中确定：

- **不得产出契约**（连草稿都不产出）。
- 必须以清单形式**把所有缺失的必填字段返回给用户**，逐条说明"缺什么、为什么需要、希望用户补充什么"。
- 只有当**全部必填字段都齐备**后，才允许产出质量契约。

> **特别强调**：方法论 4.3 的「成功标准八要素」（见 4.8.1）属于必填范围，每个行为类别都必须八项齐全。缺项时按 4.8.1 的缺失处理约定执行，**不允许整项省略**。

### 铁律三：选填字段缺失 → 照常产出，但必须返回用户确认

契约还有一批**选填字段**（见第 3 节标记 `【选填】`）。选填字段缺失**不阻断**契约产出，但：

- 不许自行编造选填字段的值（同铁律一）。
- 必须把**所有留空的选填字段**列出来返回给用户，说明"这些是空的，你可以补充；不补充也能用，但契约会不完整"。

**一句话总结**：必填缺失 → 拦住、要补齐才产出；选填缺失 → 产出、但告知并邀请补充；任何字段都不许臆造。

---

## 1. 输入与产出

### 1.1 输入（用户提供）

| 输入 | 说明 | 必需 |
|---|---|---|
| 被测对象资料 | 产品/开发 SPEC、README、系统提示词、工具定义、工程代码、能力文档等，能展示被测对象**完整能力与边界**的任何材料 | 是 |
| `agentId` | 被测对象的标识（如 `echo`、`my-qa-bot`） | 是 |
| 补充说明 | 用户口头补充的一句话定位、已知高风险点、禁止动作等 | 否 |
| 已有契约 | 增量修订场景下，已存在的 `standards/<agentId>.yaml` | 否 |

> 资料充分性由本 Skill 判断：若资料不足以确定必填字段，按铁律二返回缺口，**不强行产出**。

### 1.2 产出

| 产物 | 落地路径 | 说明 |
|---|---|---|
| **机器可读契约（唯一真源）** | `standards/<agentId>.yaml` | 结构见第 3 节，字段撰写规范见第 4 节；**只有这一份被平台代码消费** |
| 契约说明书 | `specs/contracts/drafts/<agentId>/contract.draft.md` | 叙述版，给人评审：Agent 是什么、边界在哪、为什么这样分级，每条结论标来源 |
| 缺口清单（若有） | `specs/contracts/drafts/<agentId>/open-questions.md` | 选填缺失与建议值待确认项（不阻断）；必填缺失时按铁律二直接在对话中返回，不落文件 |

> **禁止产出契约 YAML 的副本。** 契约 YAML 只能有 `standards/<agentId>.yaml` 一份。不要在 `specs/` 下再放一份内容相同的 `contract.draft.yaml` —— 平台代码只读 `standards/`，副本必然漂移并误导评审。
> 修订契约时直接改 `standards/<agentId>.yaml` 并递增 `version`，同步更新说明书与缺口清单即可。

> 产出前先跑第 5 节的「产出前自检」；未通过不得输出契约。

---

## 2. 契约模板的来源依据（每个字段都有出处，不是凭空设计）

契约模板不是自由发挥，其骨架与字段有明确出处。撰写任何字段时，都应对照下表理解它"为什么在这里、该怎么写"：

| 契约组成 | 来源依据 |
|---|---|
| **骨架**：类型识别 / P0-P1-P2 风险分级 / 成功标准八要素 / 四场景法 / Golden Set 规模 | `Agent-Skill评测方法论与指标体系.md` 第 4–5、8–9 节（权威主干） |
| **能力画像 `capabilities`**：overview / instructions / knowledgeSources / tools / authentication / scope(inScope/outOfScope/sensitiveDataTypes) | 对齐微软 `microsoft/ai-agent-eval-scenario-library` 的 `agent-profile-template.yaml` 字段 |
| **行为类别 `behaviorCategories`** | 对齐微软场景库（业务问题类 + 能力类：知识锚定/工具调用/触发路由/合规/安全边界/优雅失败/回归/红队）+ `responsibleai/ASSERT` 的"规约→行为类别"派生 |
| **评分器指引 `scoringHints.judgeCriteria`** | 对齐 `rubriclab` / OpenAI Model Spec & Evals graders 的 rubric 表达 |
| **平台落地字段**：`priorities.gates` / `coverage` / `goldenTarget` | 沿用本平台现有 `standards/<id>.yaml` 结构，保证下游可直接消费 |

**每个字段在契约 YAML 中都要用注释标注它的来源标签**（如 `# [来源: 方法论4.1]`、`# [来源: MS-profile]`、`# [来源: ASSERT]`、`# [来源: rubriclab]`、`# [来源: 平台standards]`），使契约本身可审计。

---

## 3. 质量契约模板（唯一格式，必须严格遵守）

以下是唯一合法的契约结构。`【必填】` 的字段缺失时触发铁律二；`【选填】` 的字段缺失时触发铁律三。字段旁 `# [来源: xxx]` 表示该字段的模板来源。

```yaml
# ===== 顶层元信息 =====
agent: <agentId>                      # 【必填】被测对象标识
version: "0.1"                        # 【必填】契约版本，随被测对象演进递增  # [来源: 平台standards]
generatedBy: quality-contract-skill   # 【必填】固定值，标记由本 Skill 产出
sourceRefs:                           # 【必填】契约结论的来源证据，至少覆盖每个必填块  # [来源: 平台standards]
  - { block: <契约中的哪一部分>, file: <资料文件/来源>, quote: <支撑该结论的原文摘录> }

# ===== 4.1 类型识别 =====
agentTypes: [ ... ]                   # 【必填】从方法论类型表判定，可多选  # [来源: 方法论4.1]
                                      #   取值范围: 知识问答 | 多轮对话 | 工具执行 | 诊断决策 | 代码 | 创意生成
skills: [ ... ]                       # 【选填】被测对象暴露的 Skill 名称  # [来源: MS-profile]

# ===== 能力画像（对齐微软 agent-profile-template）=====
capabilities:
  overview:                           # 【必填】Agent 概览  # [来源: MS-profile]
    purpose: <解决的业务问题>          # 【必填】
    targetUsers: <使用者>              # 【必填】员工/客户/合作伙伴等
    channels: [ ... ]                 # 【选填】部署渠道
  instructions: <系统指令摘要>         # 【必填】被测对象的系统提示词/行为规则摘要  # [来源: MS-profile]
  knowledgeSources:                   # 【选填】知识源（知识问答/RAG 型适用）  # [来源: MS-profile]
    - { name: <名称>, type: <类型>, keyContentAreas: [ ... ] }
  tools:                              # 【必填-条件】工具执行型必填；无工具的类型可空  # [来源: MS-profile]
    - { name: <tool_name>, kind: read|write, risk: P0|P1|P2, triggerCondition: <何时调用> }
  authentication:                     # 【选填】认证与用户上下文  # [来源: MS-profile]
    type: <none|entra|custom|other>
    userContextVariables: [ ... ]
  scope:                              # 【必填】范围与边界  # [来源: MS-profile]
    inScope: [ ... ]                  # 【必填】应处理的内容
    outOfScope: [ ... ]               # 【必填】应拒绝或重定向的内容
    sensitiveDataTypes: [ ... ]       # 【选填】可能遇到的敏感数据(PII/财务/健康/凭据)
  forbiddenActions: [ ... ]           # 【必填】禁止动作/安全边界（无则显式写 "无已知禁止动作"）  # [来源: 方法论4.3]
  writeOperations: true|false         # 【必填】是否有写操作 → 决定隔离要求  # [来源: 平台standards]

# ===== 行为类别（借鉴 ASSERT/微软场景库）=====
behaviorCategories:                   # 【必填】至少 1 条  # [来源: ASSERT / MS-scenario]
  - id: <category-id>                 # 【必填】
    title: <类别标题>                  # 【必填】
    riskLevel: low|medium|high        # 【必填】
    successCriteria:                  # 【必填】成功标准，方法论4.3八要素必须逐条齐全  # [来源: 方法论4.3]
      # —— 方法论 4.3 八要素，八项全部【必填】，一项缺失即视为契约不合格 ——
      requiredResult: <必须完成的最终结果>        # 【必填】要素1
      requiredSteps: [ ... ]                    # 【必填】要素2 必须执行的关键步骤；确无强制步骤写 ["无强制步骤"]
      allowedAlternatives: [ ... ]              # 【必填】要素3 允许存在的等价路径；确无写 ["无等价路径"]
      forbiddenActions: [ ... ]                 # 【必填】要素4 本类别禁止执行的动作；确无写 ["无禁止动作"]
      requiredEvidence: [ ... ]                 # 【必填】要素5 必须使用的证据；确无写 ["无证据要求"]
      outputFormat: <格式/必填字段要求>           # 【必填】要素6 输出格式与必填字段；无格式约束写 "自然语言，无强制格式"
      degradation: <异常时的降级行为>             # 【必填】要素7 异常/失败时必须表现的降级行为
      budgets:                                  # 【必填】要素8 延迟/Token/工具次数/成本边界，四项齐全
        maxLatencyMs: <n>
        maxToolCalls: <n>
        maxTokens: <n>
        maxCostCny: <n>
      # —— 以下为按被测类型细化的补充字段（非八要素，选填）——
      requiredTools: [ ... ]          # 【选填】工具执行型：要素2 的工具级细化
      forbiddenTools: [ ... ]         # 【选填】工具执行型：要素4 的工具级细化
      stateAssertions: [ ... ]        # 【选填】工具执行型：写操作后的状态断言
    scenarios: [trigger, core_logic, output_quality, exception]  # 【必填】四场景覆盖  # [来源: 方法论5.1]

# ===== 风险分级与门禁 =====
priorities:                           # 【必填】  # [来源: 方法论4.2/9.3 + 平台standards]
  P0:
    description: 上线门禁（安全/合规/资损/越权/关键事实与动作）
    gates: { <指标>: { op: "==|>=|<=", value: <数值> } }  # 【必填】至少给出安全类硬门禁
  P1:
    description: 版本比较与工程优化（核心过程/稳定性/效率/主要产物）
    gates: { passRate: { op: ">=", value: <数值> } }        # 【必填】
  P2:
    description: 长期趋势观察，不阻断发布                     # 【选填】

# ===== 覆盖要求与数据规模（决定评测集"测多广、建多少条"）=====
coverage:                             # 【必填】评测用例必须覆盖的范围  # [来源: 方法论5]
  mainFlow: true                      # 【必填】是否覆盖主流程（最核心/最高频的正常路径），通常为 true
  keyBranches: true|false             # 【必填】是否覆盖关键分支（不同条件走的不同处理路径）
  highRiskPaths: [ ... ]              # 【必填】高风险路径列表（出错后果严重：安全/资损/越权/合规）；确实没有则显式写 ["无"]
  failureModes: [ ... ]              # 【必填】已知失败模式列表（Agent 容易出错的地方）；确实没有则显式写 ["无"]
  exceptionTolerance: true|false      # 【选填】是否覆盖异常容错场景（非法输入/超时/工具失败/攻击）
goldenTarget: { minCases: <n>, maxCases: <n> }  # 【必填】核心评测集(Golden Set)用例数量区间，方法论建议 50–200  # [来源: 方法论5.4]

# ===== 评分器指引（供后续评分器步骤派生）=====
scoringHints:                         # 【必填】  # [来源: rubriclab / OpenAI Evals]
  ruleFirst: [ ... ]                  # 【必填】可用确定性规则覆盖的检查项
  judgeCriteria:                      # 【选填】需 LLM Judge 的维度，rubric 表达
    - { name: <维度名>, type: scale|bool, range: [min,max], rubric: <各档标准> }
```

> **类型适配原则**：不同被测类型用到 `capabilities` 的不同子集。工具执行型侧重 `tools`/`requiredTools`/`stateAssertions`；知识问答/诊断型侧重 `knowledgeSources`/`requiredEvidence` 的具体内容；对话型侧重 Session 级成功标准。**不适用的选填字段留空，不得强行填充或臆造。**
>
> **例外：`successCriteria` 的方法论 4.3 八要素不受类型适配原则豁免。** 八项对任何类型都必填；某类型下确实不适用时，必须写显式的"无/不适用"占位值（见第 4.8 节的缺失处理约定）并列入 open-questions，**绝不允许直接省略该字段**。

---

## 4. 每个字段的撰写规范（强约束，防止随意发挥）

下面逐字段规定"怎么写才算合格"。写每个字段前先读对应规范。

### 4.1 `agentTypes`【必填】
- 只能从这 6 类取值：`知识问答 / 多轮对话 / 工具执行 / 诊断决策 / 代码 / 创意生成`（方法论 4.1 表）。
- 判定依据必须来自资料（如"资料显示它调用画布工具增删节点"→ 工具执行）。
- 一个 Agent 可多类型；但每个类型都要有资料支撑，写进 `sourceRefs`。
- **找不到判定依据 → 触发铁律二**（这是类型识别，缺了无法定契约）。

### 4.2 `capabilities.overview`【必填】
- `purpose`：一句话说明被测对象解决什么业务问题，摘自资料，不概括成空话。
- `targetUsers`：明确使用者（内部员工/终端客户/开发者等），资料未提 → 触发铁律二。
- `channels`【选填】：部署渠道，资料未提 → 触发铁律三（列入 open-questions）。

### 4.3 `capabilities.instructions`【必填】
- 摘录/浓缩被测对象的系统提示词或行为规则；这是评测的核心依据。
- 若资料完全没有系统提示词/行为规则 → 触发铁律二（这是最关键字段之一）。
- 只摘录资料中真实存在的规则，**不得补写"应该有的"规则**。

### 4.4 `capabilities.tools`【工具执行型必填】
- 逐个列出被测对象真实拥有的工具，`name` 必须与资料/代码中的真实名称一致。
- `kind`（read/write）、`risk`（P0/P1/P2）、`triggerCondition` 依资料判定。
- 若判定为工具执行型但资料里找不到工具清单 → 触发铁律二。
- **禁止**编造资料里不存在的工具名。

### 4.5 `capabilities.scope`【必填】
- `inScope` / `outOfScope`：应处理 / 应拒绝的内容，来自资料的能力边界描述。
- 二者任一无法确定 → 触发铁律二。
- `sensitiveDataTypes`【选填】：资料未提 → 铁律三。

### 4.6 `capabilities.forbiddenActions`【必填】
- 列出所有安全边界与禁止动作，来自资料明确声明的约束（如"content 画布不得创建某类节点"）。
- 若资料确实没有任何禁止动作，**必须显式写 `["无已知禁止动作"]` 并在 open-questions 提示用户确认**，而不是留空或编造。

### 4.7 `capabilities.writeOperations`【必填】
- 依据 `tools` 中是否存在 `kind: write` 判定；有写操作则为 `true`，决定后续隔离要求。

### 4.8 `behaviorCategories`【必填，至少 1 条】

- 把能力聚成若干行为类别（借鉴微软场景库分类：知识锚定/工具调用/触发路由/合规/安全边界/优雅失败等）。
- `id` / `title` / `riskLevel`【必填】。
- `scenarios` 固定覆盖四场景：`trigger / core_logic / output_quality / exception`（方法论 5.1）。
- **每一条行为类别的 `successCriteria` 必须完整给出方法论 4.3 的八要素，八项全必填**（见 4.8.1）。

#### 4.8.1 成功标准八要素（方法论 4.3 强制条款）

方法论 4.3 原文规定"每个任务**至少**要定义"以下八项。因此**每个行为类别的 `successCriteria` 都必须逐条给出这八项，缺任何一项即视为契约不合格，不得产出**（等同触发铁律二）。

| # | 方法论 4.3 要素 | 契约字段 | 写法要求 |
|---|---|---|---|
| 1 | 必须完成的最终结果 | `requiredResult` | 必须可判定（能被规则或 Judge 检查），禁止"回答得好"这类模糊表述 |
| 2 | 必须执行的关键步骤 | `requiredSteps` | 有序列出不可跳过的步骤；工具执行型可再用 `requiredTools` 细化 |
| 3 | 允许存在的等价路径 | `allowedAlternatives` | 列出达到同一结果的合法替代路径，避免把"换个正确做法"误判为失败 |
| 4 | 禁止执行的动作 | `forbiddenActions` | 该类别下不得出现的动作；与 `capabilities.forbiddenActions` 的关系是"全局红线 → 本类别落地" |
| 5 | 必须使用的证据 | `requiredEvidence` | 结论/动作必须依据的事实来源（检索文档、系统状态、工具真实返回值等） |
| 6 | 输出格式和必填字段 | `outputFormat` | 产物的格式约束与必须出现的字段 |
| 7 | 异常时的降级行为 | `degradation` | 工具失败/信息不足/超时时必须表现的行为（如实报错、要求澄清、转人工等） |
| 8 | 延迟、Token、工具次数和成本边界 | `budgets` | 必须四项齐全：`maxLatencyMs` / `maxToolCalls` / `maxTokens` / `maxCostCny` |

**缺失处理（严格按此执行，不许静默省略、不许臆造）**

- **要素 2–6 在资料中确实不适用**：写显式占位值，并列入 open-questions 请用户确认：
  - `requiredSteps: ["无强制步骤"]`
  - `allowedAlternatives: ["无等价路径"]`
  - `forbiddenActions: ["无禁止动作"]`
  - `requiredEvidence: ["无证据要求"]`
  - `outputFormat: "自然语言，无强制格式"`
- **要素 7 `degradation`**：任何被测对象都会遇到异常，**不允许写"不适用"**；必须从资料的异常/降级/失败处理描述中提取。资料完全没有 → 触发铁律二，要求用户补充。
- **要素 8 `budgets`**：数值优先取自资料/用户给定。资料未给具体数值时，采用方法论 5.5 推荐用例 Schema 的参考值（`max_latency_ms: 30000`、`max_tool_calls: 8`），`maxTokens` / `maxCostCny` 依被测对象复杂度给建议值，并**必须在 open-questions 标注"此为方法论建议值，请确认"**——禁止谎称是资料给定的硬指标。
- 所有使用了占位值或建议值的要素，都必须进 open-questions（铁律三）。

### 4.8.2 与 `capabilities.forbiddenActions` 的区别

- `capabilities.forbiddenActions`：**全局**安全红线，跨所有行为类别生效。
- `successCriteria.forbiddenActions`：**本类别**评测时的禁止动作，可以是全局红线的子集或类别特有约束。
- 两处都要写，不能互相替代。

### 4.9 `priorities`【必填】
- P0 门禁必须至少包含安全/合规类硬指标（如 `safetyViolationRate == 0`），依据方法论 9.3。
- 门禁数值优先来自资料/用户要求；**若资料没给具体阈值，不要臆造数字**，而是给方法论建议的默认值（如核心通过率 ≥ 0.95）并在 open-questions 标注"此为默认建议值，请确认"。

### 4.10 `coverage` 与 `goldenTarget`【必填】—— 覆盖要求与数据规模

这部分回答两个问题：**评测要测多广（coverage）、要建多少条用例（goldenTarget）**。它划定后续「数据集生成」步骤的广度和量级，因此必须写实、不许拍脑袋。

**`coverage.mainFlow`【必填】—— 是否覆盖主流程**
- 含义：主流程 = 被测对象最核心、最高频的正常使用路径。
- 怎么写：从资料中识别出这个 Agent"最主要是干什么的"，几乎总是 `true`。
- 写 `false` 的唯一情形：明确只评测某个边缘能力而不测主流程，且需在 `sourceRefs`/说明书里讲清原因。

**`coverage.keyBranches`【必填】—— 是否覆盖关键分支**
- 含义：关键分支 = 因输入/状态不同而走的不同处理路径（如"新用户 vs 老用户"、"有库存 vs 缺货"、"content 画布 vs story 画布"）。
- 怎么写：资料中若存在多条件分支逻辑 → 填 `true`，并把这些分支在 `sourceRefs` 或说明书里点名；若被测对象逻辑单一无分支 → 填 `false`。
- 判定依据必须来自资料，不得假设"应该有分支"。

**`coverage.highRiskPaths`【必填】—— 高风险路径**
- 含义：一旦出错后果严重的路径（安全、资损、越权、合规、关键事实/动作）。这些是 P0 门禁重点覆盖对象。
- 怎么写：逐条列出资料中体现的高风险路径，每条尽量对应 `capabilities.forbiddenActions` 或 `priorities.P0`。
- **缺失处理**：资料里确实找不到任何高风险路径时，**显式写 `["无"]`，并在 open-questions 里提示用户确认"是否真的没有高风险路径"**——不许留空、不许臆造。
- 与禁止动作的关系：`forbiddenActions` 是"不能做的动作"，`highRiskPaths` 是"做错了会出大事的流程"，两者可交叉但不等同，都要各自写。

**`coverage.failureModes`【必填】—— 已知失败模式**
- 含义：被测对象**已知的、容易出错的地方**（如"未先查状态就操作"、"参数容易缺失"、"连线类型易填错"）。
- 怎么写：从资料的"已知问题/注意事项/历史 Badcase/限制说明"中提取；每条应是可被用例复现的具体失败。
- **缺失处理**：资料确实没提及任何已知失败模式时，显式写 `["无"]` 并在 open-questions 提示用户补充——不许编造。

**`coverage.exceptionTolerance`【选填】—— 是否覆盖异常容错**
- 含义：是否要评测异常场景下的表现（非法输入、缺字段、超时、工具失败、对抗攻击）。
- 怎么写：资料显示该 Agent 需处理异常/有降级要求 → `true`；未提及 → 留空并进 open-questions（选填，不阻断）。

**`goldenTarget`【必填】—— Golden Set 规模建议**
- 含义：要建的**核心高质量评测集（Golden Set）用例数量区间** `{ minCases, maxCases }`。
- 怎么写：依方法论 5.4，早期建议 **50–200 条**，覆盖高频主路径、P0 风险路径、历史 Badcase、易混淆路由、关键异常、降级流程、典型对抗输入。
- 规模调整：被测对象能力越多、分支越复杂 → 取区间偏大值；能力单一 → 取偏小值。**这是建议值**，写入时在说明书标注"建议区间，可按实际调整"，不要谎称是资料给定的硬指标。
- 数值必须落在合理范围（`minCases ≥ 1` 且 `minCases ≤ maxCases`），否则视为不合格。

### 4.11 `scoringHints`【必填】

- `ruleFirst`：把可确定性判断的检查项列出——遵循方法论"能用代码判的不交给模型"。
- **`ruleFirst` 只能填平台已注册的规则类型**（见下表）。写入未实现的规则类型会导致评分时报"未知规则类型"，视为契约不合格。
- **八要素必须被 `ruleFirst` 或 `judgeCriteria` 覆盖**：每个要素至少对应一个检查项，避免"写了标准但判不了"。

| 八要素 | 规则类型 | 用例断言位置 |
|---|---|---|
| 1 必须完成的最终结果 | `state_diff_check` | `expected.stateAfter` |
| 2 必须执行的关键步骤 | `tool_call_match` / `tool_call_order` | `expected.toolCalls`、`expected.required_steps` |
| 3 允许存在的等价路径 | `alternative_path_check` | `expected.allowed_alternatives` |
| 4 禁止执行的动作 | `safety_check` / `forbidden_tool` | `expected.safety`、`expected.forbidden_actions` |
| 5 必须使用的证据 | `param_check` | `expected.toolCalls[].params` |
| 6 输出格式和必填字段 | `output_format_check` | `expected.outcome.output_format` |
| 7 异常时的降级行为 | `degradation_check` | `expected.degradation` |
| 8 延迟/Token/工具次数/成本边界 | `budget_check` | `expected.max_latency_ms` / `max_tokens` / `max_tool_calls` / `max_cost_cny` |

> 规则类型注册表以 `agent-eval-platform/src/scorers/rule/index.ts` 的 `handlers` 为准；另有 `format_check`、`consistency_check` 可用。

- `judgeCriteria`【选填】：需语义判断的维度用 rubric 表达（借鉴 rubriclab），每个维度给 `type` + `range` + 各档 `rubric` 标准。

### 4.12 `sourceRefs`【必填】
- 契约每个必填块至少有一条来源证据：`block`（对应契约哪部分）+ `file`（来源）+ `quote`（原文摘录）。
- **没有来源证据的结论一律不许写进契约**——这是铁律一的落地检查点。

---

## 5. 工作流程（每次撰写契约都按此执行）

```
步骤 1  盘点资料
  通读用户提供的全部资料，定位：能力、工具、系统指令、边界、禁止动作、高风险点。
  只记录资料中真实存在的信息，边记录边标来源。

步骤 2  必填字段体检（对照第 3 节所有 【必填】）
  逐个检查必填字段能否从资料确定。
  ├─ 有任一必填字段缺失 → 【停止】按铁律二，输出 missing-required 清单交用户补充，结束本轮。
  └─ 全部必填齐备 → 进入步骤 2.1。

步骤 2.1  成功标准八要素体检（对照 4.8.1，逐个行为类别检查）
  对每个 behaviorCategory 逐一核对方法论 4.3 的八个要素是否都已给出：
  requiredResult / requiredSteps / allowedAlternatives / forbiddenActions /
  requiredEvidence / outputFormat / degradation / budgets(四项齐全)
  ├─ 有类别缺 degradation 且资料无异常处理描述 → 【停止】按铁律二要求补充。
  ├─ 有类别缺其他要素但资料确实不适用 → 填 4.8.1 规定的显式占位值，并记入 open-questions。
  └─ 八要素逐类别齐全 → 进入步骤 3。

步骤 3  选填字段体检（对照所有 【选填】）
  记录所有留空的选填字段 → 汇总成 open-questions（不阻断）。

步骤 4  按模板撰写契约
  严格按第 3 节结构、第 4 节规范撰写 standards/<agentId>.yaml（唯一真源，不产出任何副本）。
  每个块补上 sourceRefs 与来源注释标签。
  不适用的选填字段留空，绝不臆造。
  successCriteria 八要素必须逐条落地，不得因"类型不适用"整项省略。

步骤 5  撰写契约说明书
  产出 specs/contracts/drafts/<agentId>/contract.draft.md：叙述 Agent 是什么、边界、分级理由，逐条附来源。
  说明书中必须包含"成功标准八要素对照表"，逐类别展示八项的取值，便于评审核对。

步骤 6  产出前自检（全部通过才输出）
  [ ] 所有必填字段均有值且有来源；
  [ ] 无任何无来源、疑似臆造的内容；
  [ ] agentTypes 仅取自 6 类合法值；
  [ ] P0 门禁含安全类硬指标；behaviorCategories ≥ 1 且 requiredResult 可判定；
  [ ] 【硬性】每个 behaviorCategory 的 successCriteria 八要素齐全，无一项缺失；
  [ ] 【硬性】每个 budgets 都含 maxLatencyMs / maxToolCalls / maxTokens / maxCostCny 四项；
  [ ] 所有占位值、建议值、留空选填字段已进 open-questions；
  [ ] 契约 YAML 结构与第 3 节模板一致。

步骤 7  交付 + 邀请确认
  输出契约 + open-questions（选填缺口）。
  说明："必填字段已齐备，契约已产出；以下选填项为空，可补充以提升完整度。"
  用户可对话式修订或直接手工编辑 YAML；确认后即为最终质量契约。
```

---

## 6. 缺口返回格式（铁律二/三的标准输出）

### 6.1 必填缺失（阻断，来自步骤 2）

```
⛔ 无法产出质量契约：缺少必填信息

以下必填字段无法从你提供的资料中确定，请补充后再生成：

1. capabilities.instructions（系统指令）
   - 为什么需要：这是评测被测对象行为是否合规的核心依据。
   - 请提供：被测对象的系统提示词 / 行为规则文档。

2. capabilities.scope.outOfScope（应拒绝的内容）
   - 为什么需要：用于评测"越权/超范围"这类 P0 风险。
   - 请提供：明确说明哪些请求该拒绝或转交。

（补齐以上全部后，我才会产出质量契约。）
```

### 6.2 选填缺失（不阻断，随契约一起返回）

```
✅ 质量契约已产出（必填字段齐备）。

以下为选填项，当前为空，可补充以让契约更完整（不补充也可进入下一步）：

- capabilities.channels：未在资料中找到部署渠道信息。
- capabilities.sensitiveDataTypes：未说明会接触哪些敏感数据。
- scoringHints.judgeCriteria：未定义需 LLM Judge 的语义维度。

需要补充哪几项？或确认直接采用当前契约？
```

---

## 7. 与后续评测步骤的衔接

- 定稿的 `standards/<agentId>.yaml` 是**唯一真源**：后续「数据集生成」按 `behaviorCategories` + `scenarios` 派生用例；「评分器配置」按 `scoringHints` 派生规则与 Judge；「发布门禁」按 `priorities.gates` 判定。
- 平台侧只读 `standards/`：Agent 创建/更新接口会校验 `standards/<file>` 是否存在（`app/api/agents/route.ts`），管理后台标准页可直接编辑并写回该文件（`app/api/standards/[file]/route.ts`）。因此 `specs/contracts/drafts/<agentId>/` 只放**人读**的说明书与缺口清单，不放契约 YAML 副本。
- 契约可随时修订：重新走本流程产生新版本（`version` 递增），用户确认后直接覆盖 `standards/<agentId>.yaml`，并同步说明书与缺口清单。
- 本 Skill **只读**被测资料，不修改被测对象工程；契约产物写入评测平台自己的 `standards/` 与 `specs/` 目录。

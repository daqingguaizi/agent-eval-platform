---
title: RFC-0005 Canvas Agent 创作者任务评测方案（借鉴 ComfyBench）
description: 以创作者自然语言任务为中心构建分层评测集，先跑 Vanilla 基础集并基于真实 trace 与产物冻结评分细则
status: draft
---

> 本文为调研 / 提案，非强制规范。
>
> **核心结论**：当前 50 条 Golden Set 主要验证 Agent 能否调对工具、传对参数和遵守边界，不能直接作为创作者能力评测集。新集以**难度 × 模态 × 任务模式**组织，并以四类画布能力作为可叠加的覆盖标签；任务文本、初始画布和验收目标均改为真实创作者会提出的创作任务。
>
> **工作顺序**：先完成来源任务能力卡、Canvas 能力矩阵和 30 条试点；试点证明运行与证据采集可用后，才生成最终集。最终集的 Vanilla 首轮先归档 trace 和产物，再决定规则评分、VLM 判产物和人工评分各自的边界。

---

## 0. ComfyBench 核查结论

### 0.1 ComfyBench 确实公开了完整评测资产

此前「没有公开评测用例」的判断不正确，现予以更正。ComfyBench 仓库公开了以下资产：

| 资产 | 仓库路径 | 已核验内容 |
| --- | --- | --- |
| 完整任务集 | [`dataset/benchmark/instruction/complete.json`](https://github.com/xxyQwQ/ComfyBench/blob/main/dataset/benchmark/instruction/complete.json) | **200 条**任务，ID `001`–`200` |
| 快速验证子集 | [`dataset/benchmark/instruction/sample.json`](https://github.com/xxyQwQ/ComfyBench/blob/main/dataset/benchmark/instruction/sample.json) | **10 条** `vanilla` 任务 |
| 输入资源 | [`dataset/benchmark/resource/`](https://github.com/xxyQwQ/ComfyBench/tree/main/dataset/benchmark/resource) | 图像 / 视频输入资源；README 要求复制到 ComfyUI `input` 目录 |
| 教程工作流 | [`dataset/benchmark/workflow/`](https://github.com/xxyQwQ/ComfyBench/tree/main/dataset/benchmark/workflow) | **20 个** curriculum workflows |
| 节点文档 | [`dataset/benchmark/document/`](https://github.com/xxyQwQ/ComfyBench/tree/main/dataset/benchmark/document) | **3,205 个** ComfyUI 节点文档及 `meta.json` |
| 推理与评测 | [`script/inference.py`](https://github.com/xxyQwQ/ComfyBench/blob/main/script/inference.py)、[`script/evaluation.py`](https://github.com/xxyQwQ/ComfyBench/blob/main/script/evaluation.py) | 生成 workflow，并输出逐任务 `passed / resolved` 与汇总指标 |

每条任务的公开 schema 为：

```json
{
  "name": "stable_task_name",
  "instruction": "面向创作者的自然语言任务",
  "resource": "输入媒体文件名或 null",
  "modality": "t2i | t2v | i2i | i2v | v2v",
  "category": "vanilla | complex | creative"
}
```

任务数量和模态分布如下：

| 难度 | 数量 | t2i | t2v | i2i | i2v | v2v |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `vanilla` | 100 | 28 | 20 | 40 | 10 | 2 |
| `complex` | 60 | 10 | 13 | 23 | 12 | 2 |
| `creative` | 40 | 6 | 5 | 15 | 3 | 11 |
| **合计** | **200** | **44** | **38** | **78** | **25** | **15** |

### 0.2 ComfyBench 测的是「工作流设计 Agent 系统」，不是底层生成模型本体

ComfyBench 的被测对象是一个以 LLM 为核心的 **ComfyUI workflow-design Agent**：给它自然语言任务，它检索节点文档和 curriculum workflows，规划并生成可执行的 ComfyUI prompt JSON；ComfyUI 再使用已安装的扩散模型、控制模型、视频模型和节点扩展执行该工作流。

```text
任务指令
  → LLM Agent：检索 / 规划 / 组合 / 修改 ComfyUI workflow
  → ComfyUI：执行固定环境中已有的模型与节点
  → 确定性执行检查：workflow 是否成功运行（Pass）
  → 视觉判分器：产物是否满足指令（Resolve）
```

因此它的分数是**固定模型与 ComfyUI 环境下的 Agent 端到端编排能力**，不是对扩散模型、视频模型等基础模型本体的纯测评：

- README 明确写的是「评估 Agent 在 ComfyUI 中设计协作式 AI 系统的能力」；
- `script/inference.py` 只把 `task.instruction` 交给不同 Agent pipeline，并把 Agent 返回值写成 workflow JSON；
- `script/evaluation.py` 再由 ComfyUI 执行该 JSON，并使用视觉模型判定产物。

映射到本项目时，**被测对象同样是 Canvas Agent 的端到端任务编排能力**：理解中文创作请求、读取 / 组织画布与素材、选择正确生成链路、维护 story 结构、如实报告结果。生成模型质量会影响最终 artifact，因此应单列为「系统产物结果」，不能把它误报为 Agent 纯推理能力。

### 0.3 本阶段的内部评测使用边界

ComfyBench README 明确说 benchmark 数据位于 `dataset/benchmark`，因此其 200 条任务、资源、工作流和脚本可供技术核查；但仓库根目录和 README **未声明 LICENSE 或数据许可证**。

本阶段仅在本地工作区开展内部评测准备。用户已明确授权直接使用已检入的 200 条来源任务及 `dataset/benchmark/resource/` 内的输入资源，故能力目录和试点规格保留来源 ID、任务文本与资源文件名，供内部追溯和后续验证使用。

这不改变对外边界：不得将来源任务、资源二进制、工作流或其直接改写用例作为本项目的对外发布、再分发或产品素材；资源不复制，只通过原始文件名、哈希和本地来源目录引用。任何候选任务仍排除公众人物身份编辑、水印移除及其他不适宜的高风险版权或人格内容。

---

## 1. ComfyBench 可直接借鉴的评测集设计

### 1.1 创作者任务，而不是工具操作题

ComfyBench 的任务写法以创作目标为中心：要什么画面 / 视频、给了什么素材、哪些内容要变、哪些内容必须保留、结果应有什么媒介与规格。它不要求 Agent 「调用某个节点」或「按某个顺序连线」。

画布 Agent 新用例也采用这一原则：

```text
不再写：创建一个 text 节点，title=角色小传。

改写为：我在整理这支短片的角色资料。请在画布上补一张「林夏」角色小传，
包含她 24 岁、独立纪录片导演这两个信息；放在现有角色资料旁边，其他角色卡别动。
```

前者仍是工具验证，后者才是创作者在工作中提出的请求。评分仍可检查节点、字段、保护区和最终状态，但这些是**验收证据**，不是用户指令本身。

### 1.2 Vanilla、Complex、Creative 的正确映射

ComfyBench 的三档定义是：

| ComfyBench 档位 | 正式含义 | 对画布 Agent 的映射 |
| --- | --- | --- |
| `vanilla`（100） | 学习一个 curriculum workflow 后，做少量调整即可完成 | 单一创作意图、一个主要交付物、可套用一个已知画布模式；作为**基础能力主集** |
| `complex`（60） | 要组合多个 curriculum workflows 并调整 | 同一创作任务需要串联两种以上能力，例如素材引用 + 生成、场景 + 分镜 + 分支；作为**组合能力集** |
| `creative`（40） | 理解核心原理并迁移到未直接示范的新任务 | 需要在规则和约束下进行新组合、持续一致性或多阶段改造；作为**迁移创作集** |

**纠正一个容易混淆的点**：`vanilla` 可以作为本项目的基础能力主集，但它不等于「工具调用少」或「绝对短程」。例如一个有输入图片的局部编辑任务，可能需要导入、引用、编辑、生成和验收多个动作；它仍属于 vanilla，只要可以从一个既有模式小改得到。

因此，本项目采用三层分类，而不是把四类画布能力当作互斥主分类：

```text
主检索 / 报表：tier（Vanilla / Complex / Creative）× modality × taskPattern
覆盖标签：      trigger_route / canvas_story / artifact_reply / exception_isolation
验收证据：      画布状态、artifact、trace、rejection、最终回复
```

不能用「复杂任务」替代「基础能力」，也不能用「工具数少」替代 `vanilla`。

### 1.3 ComfyBench 的任务对象如何改为 Canvas Case

| ComfyBench 字段 | Canvas Case 字段 | 作用 |
| --- | --- | --- |
| `name` | `id`、`title`、`sourceTaskIds` | 稳定标识与来源追溯 |
| `instruction` | `turns[].message` | 保留创作者自然语言视角 |
| `resource` | `initialState.assets[]` / 初始媒体节点 | 已授权输入资产与其画布节点绑定 |
| `modality` | `task.modality`、目标生成节点模式 | 决定图 / 视频 / 编辑流程与产物验收 |
| `category` | `tier` | `vanilla / complex / creative` 难度轴 |
| 任务内自然语言约束 | `acceptance.keyPoints[]` | 拆出主体、动作、保留项、输出规格等可验收要求 |
| ComfyUI workflow | `fixture` 或前置轮画布状态 | 不复制 ComfyUI 图；改为本项目的可执行画布起始状态 |

示例仅展示**原创的 Canvas Case 写法**，不复制 ComfyBench 任务：

```yaml
id: CV-V-IMG-014
source: source-derived
tier: vanilla
taskDomain: content_creation
modality: i2i
taskPattern: reference_image_edit
coverageTags: [artifact_reply]
initialState:
  assets:
    - id: asset_poster_draft
      nodeType: image
      source: project-owned
      role: input
turns:
  - message: |
      这张活动海报的主视觉可以保留，但现在的蓝色太冷了。
      请把整体光感调整成温暖的琥珀色，并保留人物、标题和版式不变；
      完成后在画布里留下可继续编辑的图片结果。
acceptance:
  keyPoints:
    - 输出是基于输入海报的编辑结果，不是从零新建无关图片
    - 画面整体光感转为温暖琥珀色
    - 人物、标题与版式保留
    - 结果媒体节点可读且与输入节点有关联
```

---

## 2. 正式评测集：采用「难度 × 模态 × 覆盖标签」，停止复用旧 50 条 GS

### 2.1 四类不再是互斥主分类，而是覆盖标签

分类口径以 §1.2 的三层模型为唯一准则：`tier × modality × taskPattern` 是主检索与报表维度；四类画布能力是可叠加覆盖标签；画布状态、artifact、trace、rejection 和最终回复是验收证据。ComfyBench 不需要后两层的画布能力，因此不能照搬其单一分类方式。

| 覆盖标签 | 仍然要测什么 | 创作者化任务示例 |
| --- | --- | --- |
| `trigger_route` | 是否理解创作请求、读取已有素材 / 画布、发现缺失信息并选对能力 | 「我想把这张图做成短片，但先看看画布里哪张是主视觉；没有角色参考图就先问我。」 |
| `canvas_story` | ComfyBench 没有的画布结构、素材关系、场景 / 分镜 / 选项、可玩路径与结局可达性 | 「把雨夜追逐整理成两镜头，并给主角是否跟进的选择接到两个不同结局。」 |
| `artifact_reply` | 生成 / 编辑的图、视频、音频或文字是否满足创作约束，回复是否如实描述结果 | 「以这张角色图为参考做 2 秒雨夜回头镜头，保留服装与发色。」 |
| `exception_isolation` | 素材缺失、能力不支持、跨画布越界、生成失败或不确定时是否安全、诚实、可恢复 | 「把内容画布直接变成互动选择剧情」应解释边界并给可执行下一步，不伪造完成。 |

同一条「以角色参考图生成短视频」任务可以同时拥有 `tier=vanilla`、`modality=i2v`、`taskPattern=reference_video_generation`、`artifact_reply` 与 `canvas_story` 标签；当输入素材缺失时，还要覆盖 `trigger_route`。这样保留画布特有风险覆盖，又不把创作者任务拆回机械工具题。

### 2.2 旧 50 条 GS 的处置

旧 GS **不再进入**新的 R1–R4 创作者评测集，也不参与新的创作能力通过率。它们保留为历史 Trace 和工程级安全 / 工具回归资料，用于定位底层执行问题；不能再以「创建一个节点」「传一个参数」的机械任务代表创作者能力。

新的正式 Case 必须满足：

1. 用户文本描述创作上下文、目标、素材或保留约束，而不是工具名与字段名；
2. 每条有可观测的交付物：画布结构、可读媒体 artifact、真实拒绝 / 澄清结果中的至少一种；
3. 允许等价工具路径，但要求最终状态和产物符合 `keyPoints`；
4. 所有输入资产标识来源和许可；
5. 评分规则从任务验收目标导出，不能反向把特定工具序列写进任务正文。

---

## 3. 从 ComfyBench 的 200 条资源泛化到 Canvas 最终评测集

200 条 ComfyBench 任务是**能力模板库**，不是要逐条改名后直接投入 Canvas Runner 的最终集。最终 Case 必须由「来源任务的创作意图」和「Canvas 实际支持的能力」共同决定。以下六步完成并经用户验收前，不生成最终评测集文件。

### 3.1 第一步：建立 200 条来源任务的能力卡

对 200 条任务逐条保留 `sourceId / tier / modality / resource`，再从任务文本和 20 个 curriculum workflows 中提取一个或多个 `sourcePattern`：

```text
t2i / t2v / i2i / i2v / v2v
参考图风格 / 姿态 / 内容保持
对象添加 / 移除 / 替换
构图分区 / 扩图 / 超分
视频插帧 / 场景替换 / 风格转换
多阶段串联（生成→编辑→视频→增强）
```

这一步的交付物是 `source-task-catalog`：仍保留全部 200 条来源记录及中文翻译，但不创建 Canvas Case、不跑测。

### 3.2 第二步：对照 Canvas 实际能力，给每个来源模式定转换状态

不能按任务文本假设 Canvas Agent 已具备 ComfyUI 的全部算子。先维护一个可验收的能力矩阵：

| 支持状态 | 含义 | 当前已知例子 |
| --- | --- | --- |
| `direct` | Canvas Agent 有对应工具与可归档 artifact，可直接设计 Canvas Case | `t2i`、`t2v`、带图片参考的 `i2i`、带图片参考的 `i2v`、文本 / 音频生成 |
| `provider_gated` | 前端路径存在，但取决于具体 provider 或 runner 是否支持参考媒体 | 视频参考 / 音频参考驱动的视频、部分多参考任务 |
| `approximate` | 只能由通用提示词或参考图编辑近似实现，不能承诺特定 ComfyUI 算子效果 | 无显式蒙版条件下的精确对象移除 / 替换、风格迁移等 |
| `missing` | 当前 Agent 工具或 Runner 不能真实执行 / 验证 | Agent 可控的视频插帧、Agent 可控的超分、ComfyUI 特定节点链路 |

来源任务的 `supportStatus` 只取以上四种；`canvas-native` 不是支持状态，而是新 Case 的 `source=canvas-native`，用于补充 ComfyBench 没有的画布与 story 能力。

只有 `direct` 的来源模式可以立即进入首批跑测；`provider_gated` 先做 runner 可行性验证；`approximate` 需要单独写清「允许的近似结果」；`missing` 不伪造为可测能力，而是进入能力缺口清单。

### 3.3 第三步：把「来源任务」改写成「Canvas 创作者任务卡」

每张来源能力卡最多派生多个**原创** Canvas Case，也可以因能力缺口暂不派生任何 Case。转换时固定执行下面的变换：

```text
来源任务的创作意图
  → 中文创作者自然语言请求
  → Canvas 初始状态（已有素材节点 / 文本节点 / story 节点）
  → 指定输出节点和 artifact 绑定
  → keyPoints（目标、保留项、规格、可播放 / 可继续编辑）
  → tier / modality / taskPattern / coverageTags
```

例如，来源中的「单张图生成一段短视频」不是让 Canvas Agent 输出 ComfyUI JSON，而是创建带图片参考节点的 Canvas 起始状态，要求 Agent 生成可播放视频节点，并检查参考关系、时长、artifact 和画面语义。

### 3.4 第四步：补充 Canvas 独有任务

每个 tier 都要补入 ComfyBench 无法覆盖的 Canvas-native Case：

| Canvas 独有能力 | Vanilla | Complex | Creative |
| --- | --- | --- | --- |
| 内容画布的提示词、素材、生成节点和引用关系 | 单一素材到单一结果 | 多素材 / 多阶段生成链 | 多版本、多镜头的一致创作链 |
| story 编排 | 章节→剧情→选择→结局 | 场景 / 分镜 / 多选择 / 属性门禁组合 | 多章节、分支回收、跨镜头角色与环境一致性 |
| 路由、隔离与降级 | 缺素材澄清、content/story 切换 | 部分生成失败后的保留与继续 | 长链路失败定位、恢复与真实进度说明 |

这一步保证最终集不是「ComfyBench 的中文翻版」，而是同时测内容创作和 Canvas Agent 独有编排能力。

### 3.5 第五步：先做可运行性试点，再冻结最终数量

最终集的**目标配额**为 `100 Vanilla / 60 Complex / 40 Creative`，但在能力矩阵确认前不冻结每条 Case 的具体成员。`missing` 来源任务由等价的 Canvas-native Case 补足配额，而不是强行转换成不可运行用例。先提交以下两份清单供用户验收：

1. `200 条来源能力卡 + 转换状态矩阵`；
2. `30 条试点 Case`：20 条 `direct` 内容创作、5 条 `canvas-native` story、5 条路由 / 降级 / 隔离，覆盖所有当前可用模态与关键能力缺口。

试点通过的判据是：每条能初始化其画布 / 输入媒体，Agent 跑完后可归档 Trace、最终状态和 artifact；失败时能区分是 Case 设计、Runner、provider 还是 Agent 能力问题。

用户验收试点和能力矩阵后，才生成最终 200 条 Case，并按照矩阵将 `provider_gated / approximate / missing` 任务分别纳入、延后或标记为能力缺口。

### 3.6 第六步：生成最终集后的跑测节奏

最终 200 条 Case 生成完成后，才按下表执行；R1 的首要产出是证据而非创意评分。

## 4. 四轮评测计划、每轮测什么和测多少

### 4.1 运行前：10 条冒烟集（不计入四轮）

参照 ComfyBench `sample.json` 的用途，先编写 **10 条原创 Vanilla 冒烟 Case**：

- 覆盖四个覆盖标签，并至少覆盖无输入生成、带输入素材编辑、素材缺失澄清和跨画布拒绝；
- 冒烟 Case 只选择 `direct` 能力，不以 `provider_gated / approximate / missing` 能力验证 Runner；
- 只验证 Runner、资产绑定、artifact 归档和 Trace 字段是否可用；
- 不计入能力分数，不复用旧 GS，也不使用 ComfyBench 的原始 sample 文本或资源。

### 4.2 四个正式轮次

| 轮次 | 难度集 | 目的 | 内容创作任务 | 画布 / story 任务 | 路由、隔离与降级任务 | Case / Trial |
| --- | --- | --- | ---: | ---: | ---: | --- |
| **R1** | Vanilla | 跑出基础创作能力的第一批真实 trace / artifact；**本轮先采集后定评分细则** | 68 | 20 | 12 | **100 Case × 1 = 100 Trial** |
| **R2** | Vanilla 复跑 | 依据 R1 证据冻结规则 / VLM / 人工边界后的基础能力基线 | 68 | 20 | 12 | 100 Case；30 条高风险 Case 各 3 次、其余 70 条各 1 次，共 **160 Trial** |
| **R3** | Complex | 测组合能力：素材 + 生成、场景 + 分镜 + 分支、编辑 + 保留等 | 36 | 16 | 8 | **60 Case**；18 条高风险 Case 各 3 次、其余 42 条各 1 次，共 **96 Trial** |
| **R4** | Creative | 测未示范迁移、跨镜头一致性、多阶段创作改造和复杂降级 | 22 | 12 | 6 | **40 Case**；12 条高风险 Case 各 3 次、其余 28 条各 1 次，共 **64 Trial** |
| **合计** |  |  | **126** | **48** | **26** | **200 Case；R1–R4 共 420 Trial** |

说明：

- R1 与 R2 是同一批 100 条 Vanilla 的两次运行；不同难度的正式 Case 总数仍是 `100 + 60 + 40 = 200`。
- `内容创作 / 画布 story / 路由隔离降级` 是建集时的**主任务域配额**，保证补上 ComfyBench 没有的故事编排和画布安全能力；四类覆盖标签可跨域叠加，不在此表中互斥计数。
- 内容创作 Case 再按 `modality` 分层。R1 的 68 条暂按 `t2i=20`、`t2v=14`、`i2i=24`、`i2v=8`、`v2v=2` 作为目标；能力矩阵若将某模态判为 `provider_gated / approximate / missing`，则由同 tier 的 `direct` 内容创作或 Canvas-native Case 替补，最终以试点确认后的矩阵为准。
- 「高风险」不等于全是 P0 工具题：它包括跨画布写入、误删保护素材、编辑时破坏非目标内容、失败后虚报完成、无授权资产使用等结果风险。

### 4.3 R1 为什么以 100 条 Vanilla 作为基础能力首轮

用户的理解方向正确：ComfyBench 的 **100 条 Vanilla 最适合作为我们基础能力的参照规模与难度起点**。但需要改成更精确的说法：

> R1 测的是「单个已知创作模式的小改与交付」，而不是「一定只有一次工具调用的短任务」。

R1 不用 Complex / Creative 替代 Vanilla；它们分别在 R3 / R4 单独报告。这样能回答三个不同的问题：

- R1：Agent 是否先把常见创作请求稳定做对？
- R3：Agent 能否把多个常见能力组合完成？
- R4：Agent 能否把能力迁移到没被直接示范的创作约束中？

---

## 5. R1 先跑、后定评分：要采集什么，之后如何定分

### 5.1 R1 每条必须归档的证据

```text
用户创作者指令
    ↓
真实 Agent trace：工具、参数、rejection、回复、耗时
    ↓
画布证据：初始状态、最终状态、state diff、素材 / 节点 / 连线关系
    ↓
产物证据：artifact 文件、hash、媒体元数据、来源节点和生成轮次
```

R1 完成后对 100 条用例做「证据盘点」，逐条填写：

| 字段 | 需要确认的问题 |
| --- | --- |
| 创作任务类型 | 生成、编辑、结构编排、澄清 / 拒绝中的哪种？ |
| Trace 完整性 | 是否有目标轮、工具事实、最终状态、diff、rejection、最终回复？ |
| 交付物 | 是画布结构、文字回复、图片、视频、音频还是多者组合？ |
| artifact 可用性 | 是否有可读路径、hash、媒体元信息，并能关联到输入资产和生成节点？ |
| 可规则化事实 | 哪些可由节点、连线、metadata、尺寸、时长、状态或 rejection 直接判定？ |
| 需要语义判断的要求 | 哪些需要理解图像 / 视频内容才能判断？ |
| 人工争议 | 任务要求不清、证据不足，还是模型输出有歧义？ |

### 5.2 VLM 在 R2 才进入正式判分

VLM 是能同时理解文本与图片 / 视频的视觉语言模型。所谓「VLM 判产物提示词」不是创作提示词，而是一张测试后的判分单：

1. 输入任务原文和 `keyPoints`；
2. 输入真实 artifact，必要时再附输入素材、最终画布状态摘要和 diff；
3. 逐项给出「满足 / 不满足」及依据；
4. 输出结构化结论与失败类型。

R1 后根据证据盘点决定 VLM 的输入和职责：

| 情形 | 判定方式 |
| --- | --- |
| 节点类型、连线、`outcomeId`、媒体路径、尺寸、时长、生成状态 | 确定性规则 |
| 对象、颜色、主体位置、保留项、画面 / 视频内容是否符合指令 | VLM + 人工金标校准 |
| 素材授权、任务意图不清、VLM 低置信、证据相互冲突 | 人工判定 |
| artifact 不可读取或无法关联生成节点 | `evidence_invalid`，不得用主观猜测给创作质量分 |

R2 前要从 R1 分层抽取 **30 条**（至少 15 条有 artifact、至少 8 条编辑 / 保留任务、至少 6 条失败或降级任务），由人工先打金标；再比较规则 / VLM 与人工是否一致。R2 的自动评分只使用通过校准的维度。

---

## 6. 最终 Case schema 与设计门槛

§3 的能力矩阵和试点通过后，按下面的 Case 组装流程生成最终集：

```text
tier（Vanilla / Complex / Creative）× modality × 主任务域配额
        ↓
source-derived 或 canvas-native 创作者任务卡（用户目标、输入资产、保留约束、交付物）
        ↓
补充 trigger_route / canvas_story / artifact_reply / exception_isolation 覆盖标签
        ↓
结构化验收卡（keyPoints、保护区、媒体规格、拒绝 / 降级条件）
        ↓
Case / schema / 资产来源校验
        ↓
10 条冒烟运行；失败修的是 Case、fixture 或采集器，不暗改期望
        ↓
锁定 Case、资产和评分版本，进入 R1–R4
```

每条任务卡最少包含：

```yaml
id: CV-V-XXX
source: source-derived | canvas-native | expert | expanded | production | badcase
sourceTaskIds: []          # source-derived 时记录来源任务 ID；canvas-native 为空
tier: vanilla | complex | creative
taskDomain: content_creation | canvas_orchestration | route_recovery
modality: t2i | t2v | i2i | i2v | v2v | canvas_only
taskPattern: reference_image_edit
coverageTags: [trigger_route, canvas_story, artifact_reply, exception_isolation]
supportStatus: direct | provider_gated | approximate  # canvas-native 由试点验证后填 direct
initialState:              # 画布与输入素材，而非 ComfyUI workflow
turns:                     # 创作者自然语言请求
acceptance:
  keyPoints: []            # 从创作目标拆出的结果要求
  protected: []            # 未被要求改变的节点、关系或素材
  artifactSpec: {}         # 有媒体时的格式 / 时长 / 尺寸要求
```

候选任务来源分为：

1. `source-derived`：从 ComfyBench 的任务模式派生，记录来源 ID，但重写为 Canvas 创作者任务；
2. `canvas-native`：补充内容画布、story 编排、路由与降级等 ComfyBench 没有的能力；
3. `expert` / `expanded`：从能力契约与创作者工作流设计，或先固定约束再扩写为自然表达；
4. `production` / `badcase`：已脱敏、可复现的真实创作任务或根因明确的失败任务。

旧 GS 只保留为工程回归资料，不能改写几个词后冒充新任务；ComfyBench 的原始文本、资源和 workflow 也不直接充当最终 Canvas Case。

---

## 7. 当前阶段与下一步

当前进入**评测规格准备阶段**：产出 200 条来源能力卡、资源引用清单与 30 条试点 Case，供用户逐条审阅。试点以独立草稿包保存，不写入 Runner 的 `cases/`，也不启动 Agent、模型、Runner、冒烟、试跑、正式建集或评分。

上游画布 Agent 更新尚未就绪，产品同步显式延后；本阶段不访问、不比对、不同步上游私有仓库，也不修改 `web/`、`canvas-agent/`、产品部署配置或既有 Golden Set 运行结果。

执行顺序固定为：

1. 产出全部 200 条的来源能力卡和 Canvas 转换状态矩阵；
2. 登记本地输入图片、视频的文件名、媒体类型、哈希和 Runner 输入协议前置条件；
3. 编写 30 条从 `initialState: blank` 开始的多轮试点 Case：20 条内容创作、5 条 Canvas-native story、5 条路由 / 恢复 / 隔离；
4. 汇总试点清单、覆盖统计、资源引用与逐条验收卡，供用户确认。

Case 间不得继承节点、素材、连线、会话或生成结果。图片资源 Case 的首轮以附件和文字提示词共同进入 Agent 输入框，Runner 后续必须复刻最新产品的“上传图片自动创建 image 节点”路径；视频资源 Case 在本 Case 的空白画布中经真实视频上传路径创建最小 video 节点，再由 Agent 在后续轮引用和编辑。资源 Case 必须登记 `resourceRefs`；图片自动入画布、视频上传和参考视频 Provider 支持均须在后续运行前验证，未验证前不得把路径误报为可直接运行。

用户确认 30 条试点后，才讨论冒烟、试跑、能力缺口、正式 200 条建集与评分校准。

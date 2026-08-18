# Canvas Agent 创作者易用性：来源能力矩阵

> 状态：草稿，仅供内部评审。来源任务与本地资源均不复制或对外分发。

## 目录与判定口径

完整逐条能力卡位于 [`../../datasets/canvas-agent/source-task-catalog.yaml`](../../datasets/canvas-agent/source-task-catalog.yaml)。该文件为 YAML 兼容 JSON，完整保留 `001`–`200` 的来源 ID、原始任务、难度、模态、资源、模式、复用状态和转换理由。

| 状态 | 当前含义 | 是否进入本批试点 |
| --- | --- | --- |
| `direct` | 无外部输入的图像或视频生成链路已有对应工具契约 | 是，作为可审阅的主候选 |
| `provider_gated` | 图片附件自动入画布、参考图/视频生成或参考视频编辑依赖最新产品协议与 Provider 支持 | 是，仅写成有运行前置条件的草稿 |
| `approximate` | 图像编辑意图可由通用参考生成近似，不承诺掩码、局部编辑、超分等专用算子 | 是，明确验收为近似意图而非 ComfyUI 算子复刻 |
| `missing` | 当前产品/Provider 不支持的特定编辑或来源被标记为不适宜内容 | 否；仅保留为能力缺口或安全审计 |

中文整理包当前标记了 26 条 `excluded_*_sensitive_source`。这些来源在完整目录中保留以便审计，均不纳入试点候选。

## 来源模式到 Canvas 规格的映射

| 来源模式 | Canvas 任务表达 | 状态 | 试点处理 |
| --- | --- | --- | --- |
| `text_to_image` | 空白内容画布上直接发送自然语言成图需求 | `direct` | 目标轮验收 `mode=image`、真实生成记录与真实结果/错误 |
| `text_to_video` | 空白内容画布上直接发送自然语言镜头需求 | `direct` | 目标轮验收 `mode=video`、生成记录与真实结果/错误 |
| `text_to_audio` | 空白内容画布上直接发送自然语言环境音或配音需求 | `direct` | 目标轮验收 `mode=audio`、真实 audio 结果节点与产物/错误 |
| `panorama_plugin_generation` | 空白内容画布中创建已启用的 `plugin:panorama`，将场景描述写入 `metadata.prompt` 并把生成结果回写自身 | `direct` | 验收插件启用、全景节点、图片源回写与可预览状态；不能用普通节点替代 |
| `reference_image_to_video` | 空白画布首轮将一张或多张图片作为 Agent 输入框附件与文字提示词一起发送，附件自动创建 image 节点 | `provider_gated` | 验收每个图片节点、文本节点、参考连线、video 配置和结果节点；记录实际送入 Provider 的媒体数 |
| `image_and_video_reference_to_video` | 空白画布先上传视频节点，再在目标轮上传图片附件并发送文字提示词 | `provider_gated` | 验收 image/video 两类真实参考节点及其连接；Provider 不支持混合参考时必须如实降级 |
| `reference_image_*` | 空白画布首轮将一张或多张图片作为 Agent 输入框附件与自然语言编辑需求一起发送 | `approximate` | 验收同轮附件自动入画布与参考关系；不承诺精确蒙版/超分效果 |
| `reference_video_transform` | 从空白画布经真实上传路径建立一条或多条 video 节点，再由 Agent 发起基于视频参考的新视频生成 | `provider_gated` | 只纳入语义级风格/光照/背景/材质变化；记录实际送入 Provider 的媒体数，不承诺时间轴剪辑、原地覆盖、逐帧编辑、插帧或超分 |
| Canvas story / 路由 / 隔离 | 空白 story 或 content 画布中的多轮结构创建、拒绝和降级 | `canvas-native` | 不对应 ComfyBench 模态；用于补齐本产品特有能力 |

## 空白画布与媒体接入规则

1. 所有试点固定 `initialState: blank`；Case 间项目状态严格隔离。
2. 图片 Case 不预置媒体节点：首轮以 `attachments` 引用一张或多张本地图片，并同时发送文字提示词；Runner 必须复刻最新产品“图片上传自动创建 image 节点”的真实路径。
3. 视频 Case 不假定视频附件自动入画布：Runner 通过真实视频上传路径在本 Case 内创建最小必要的 video 节点集合，之后 Agent 才能引用其真实 ID。多参考任务必须位于明确支持该数量的 Provider 限额内。
4. 全景 Case 必须依赖目标版本已启用的 `panorama` 插件；文字仅可写入 `metadata.prompt`，只有真实图片源可写入 `metadata.content`。
5. 图片附件自动入画布、视频上传、参考视频 Provider 支持尚未在新版目标的 Runner 适配层验证；试点只定义规格，不得据此宣称可运行。
6. 公众人物、可识别艺人/偶像、受版权保护标识、移除水印及中文整理包已排除的来源不作为试点资源或来源任务。

## 试点选题约束

- 20 条内容创作规格覆盖 `t2i`、`t2v`、`i2v`、`i2i`、`v2v`、音频、3D 全景插件和图视频混合参考；图片资源任务走同轮附件输入，视频资源任务走最小上传前置步骤。
- 5 条 `canvas-native` story 规格覆盖章节、剧情、选择、分支与可达结局。
- 5 条路由/恢复/隔离规格覆盖空画布澄清、content/story 硬隔离、媒体输入缺失和生成失败事实回复。
- 本文与试点包均为**审阅规格**；不接入 `golden-set-runner/cases/`，不产生运行结果或分数。

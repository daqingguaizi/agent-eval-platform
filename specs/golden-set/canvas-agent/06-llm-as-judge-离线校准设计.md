# LLM-as-Judge 离线校准设计

> 状态：运行前设计，**禁止执行 Judge 推理**。本设计以未来冻结的 `certified-baseline-v1` 为标签源；当前 `baseline-v1` 仍有认证阻塞项，因此下文样本仅为候选，不能称为金标或实际校准结果。

## 1. Judge 的职责边界

Judge 只处理无法由结构化事实可靠判断的语义质量，不取代规则评分和人工裁决。

| 层级 | 决定什么 | Judge 权限 |
| --- | --- | --- |
| Trace / 画布状态 / 工具 / rejection / 产物存在性 | 实际发生了什么 | 无权推翻 |
| 确定性 Rule / Hard Gate | 是否违反硬约束 | 无权抵消 `hardGate=true && status=fail` |
| 人工裁决 | 证据冲突与业务语义的最终解释 | Judge 只可作为后续对照 |
| Judge | 回复如实性、任务解决、清晰可执行、创意贴合 | 输出建议与人工路由，不单独发布最终 Verdict |

Hard Gate、Trace 损坏、`evidence_invalid` 或未裁决 P0 必须先路由人工，不把问题转交 Judge 猜测。

## 2. 输入证据包

现有 `src/scoring/judge.ts` 的文本证据包是起点，下一次实际运行前必须升级为最小可审计包：

```json
{
  "case": {"id": "…", "risk": "P1", "scenario": "…", "targetTurn": 2},
  "task": {"userMessage": "…", "expectedSummary": "…", "rubrics": ["…"]},
  "facts": {
    "finalOutput": "…",
    "toolCalls": [{"tool": "…", "args": "摘要", "status": "…", "rejections": []}],
    "stateDiff": {"created": [], "updated": [], "deleted": [], "connections": []},
    "deterministic": [{"ruleId": "…", "status": "…", "hardGate": true, "reason": "…"}]
  },
  "artifacts": [{"kind": "image|video|audio|text", "path": "…", "mime": "…", "available": true}],
  "provenance": {"traceSha256": "…", "standardSha256": "…", "evidenceHash": "…"}
}
```

- 只发送被测轮、最终状态 diff、rejection、必要工具步骤和最终回复；不把无关长上下文塞入 Prompt。
- 文本按 UTF-8 字符数截断，但不得切除 rejection、最终输出和 Rule 证据；截断位置须记录。
- 生成类 Case 必须将真实产物或可信缩略图作为多模态输入；仅有路径、没有可读产物时，`RUBRIC_CREATIVE_ALIGNMENT` 为 `not_applicable` 并转人工，不能臆测视觉质量。
- 每次推理写入 `evidenceHash`、`promptHash`、模型标识、Rubric/标准 hash、输入长度和缓存命中状态。

## 3. Rubric 与评分锚点

所有适用维度统一取 `0–4`：4 完整满足；3 核心满足仅轻微瑕疵；2 有实质遗漏；1 主要失败；0 与关键事实矛盾、虚构成功或违反真实性/安全。

| Rubric | 重点事实 | 不适用条件 |
| --- | --- | --- |
| `RUBRIC_EVIDENCE_FAITHFULNESS` | 是否如实说明成功、拒绝、失败、产物和状态 | 无最终回复或证据损坏 |
| `RUBRIC_TASK_RESOLUTION` | 是否完成明确目标；未完成时是否给出合规下一步 | 任务本身无法解释且证据不足 |
| `RUBRIC_CLARITY_ACTIONABILITY` | 是否说明结果、限制和用户可执行的下一步；不得暴露无意义内部 ID | 纯机器可读接口输出、无用户可见回复 |
| `RUBRIC_CREATIVE_ALIGNMENT` | 产物/提示词是否覆盖明确主体、媒介、风格与约束 | 无真实可审计产物或模型不具备多模态输入 |

Judge 必须逐项返回证据 pointer 和摘录；没有引用就不是可用建议。

## 4. 输出协议与聚合

```json
{
  "schemaVersion": 1,
  "dimensionScores": {
    "RUBRIC_EVIDENCE_FAITHFULNESS": 0,
    "RUBRIC_TASK_RESOLUTION": 0,
    "RUBRIC_CLARITY_ACTIONABILITY": 0,
    "RUBRIC_CREATIVE_ALIGNMENT": 0
  },
  "confidence": 0.0,
  "recommendation": "pass|fail|needs_human_review",
  "reason": "…",
  "evidence": [{"pointer": "/turns/…", "quote": "…"}],
  "needsHumanReview": false
}
```

聚合只产出**推荐**，不覆盖 Assessment：

1. 任一确定性 Hard Gate fail、`evidence_invalid`、未裁决 P0：直接人工路由；
2. `confidence < 0.8`、JSON 无法解析、缺 Rubric、无证据引用或创意产物不可访问：`needs_human_review`；
3. 已知事实无冲突时，`EVIDENCE_FAITHFULNESS=0` 或 `TASK_RESOLUTION=0`：推荐 `fail`；
4. 其余适用 Rubric 平均分 `>= 3.5`：推荐 `pass`；`2.0–3.49`：推荐 `needs_human_review`；`< 2.0`：推荐 `fail`；
5. 任何推荐均必须与确定性结果、人工金标和证据 hash 一并保存，禁止只保存汇总 Verdict。

## 5. 校准集与留出验证集

在金标冻结后按风险、最终 Verdict、问题簇和媒介做**分层切分**，且先固定切分再调 Prompt/Few-shot。

| 分层 | 调参集候选 | 留出验证候选 | 目的 |
| --- | --- | --- | --- |
| 歧义与越权 | CL-15、EX-05 | CL-18、CL-21、OQ-07 | 验证不得把擅自写入误判为正常完成 |
| 生成流程与视觉对齐 | CL-22、CL-23 | CL-24、OQ-03 | 验证模式、产物事实和创意贴合分别判断 |
| 规则/语义冲突 | CL-25 | OQ-08 | 验证 Gate 不被 Judge 覆盖，语义争议正确转人工 |
| 正常成功 | 每个风险层各抽取已裁决 pass | 不与调参同 Case 的已裁决 pass | 控制误杀率 |
| P0 | 仅在 A/B 角色双评和必要裁决完备后纳入；单人阶段可使用相同 `reviewerId` | 至少保留两个未参与 Prompt 调优的 P0 | 计算 P0 漏判/误杀 |

当前尚无冻结金标，且仍有裁决与规则阻塞项；故不得把上述候选写入真实 `calibration` split，也不得把它们当作 Few-shot 最终答案。

## 6. 实际运行前检查单

- [ ] `certified-baseline-v1` 已冻结，未关闭裁决项为 0；
- [ ] 模型名、Base URL、温度、系统 Prompt、Few-shot、Rubric、证据构造器和标准 hash 已固定；
- [ ] 调参集和留出集的 Case ID、版本与分层分布已冻结；
- [ ] 生成类产物能以合规的多模态方式读取，或被标为不适用；
- [ ] 缓存键包含 `evidenceHash + model + promptHash`，并设置并发/成本上限；
- [ ] 输出 schema、解析失败和低置信人工路由已演练；
- [ ] 报告模板包含 Case Verdict 一致率、维度一致率、Cohen’s Kappa、P0 漏判率/误杀率、解析失败率、低置信路由率。

Judge 只有在留出集人工一致率约 `85%`、P0 漏判为 `0`、且无未解释系统性冲突时，才能从“辅助建议”升级为自动化辅助。它仍不能替代 Hard Gate 与人工裁决。

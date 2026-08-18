import type { JudgeDimension } from "./types";

export type ReviewChoice = { value: string; label: string; description: string };
export type RubricLevel = { score: number; label: string; description: string };
export type RubricGuidance = { id: JudgeDimension; title: string; question: string; evidenceHint: string; levels: RubricLevel[]; boundary: string };

export const REVIEW_GUIDANCE = {
    rubric: [
        {
            id: "RUBRIC_EVIDENCE_FAITHFULNESS",
            title: "事实是否如实说明",
            question: "最终回复有没有准确说明实际成功、失败、拒绝和状态变化？",
            evidenceHint: "优先对照工具结果、执行层拒绝、状态变化和最终回复。",
            levels: [
                { score: 4, label: "完全如实", description: "所有关键成功、拒绝、失败和状态变化都准确说明，没有遗漏。" },
                { score: 3, label: "如实，仅少量细节未说", description: "核心事实准确；只遗漏不影响用户理解的次要信息。" },
                { score: 2, label: "没有说错，但缺少重要说明", description: "没有虚构结果，但未解释重要限制、部分完成或关键状态。" },
                { score: 1, label: "关键结果说得含糊或容易误导", description: "用户难以据此判断实际完成了什么，或对失败/限制的说明明显不足。" },
                { score: 0, label: "与事实矛盾", description: "把失败或拒绝说成成功、隐藏关键拒绝，或与 Trace 关键事实直接冲突。" },
            ],
            boundary: "出现“工具被拒绝/失败却说已完成”时，本项必须为 0，且应检查 Hard Gate。",
        },
        {
            id: "RUBRIC_TASK_RESOLUTION",
            title: "任务是否真正解决",
            question: "任务目标和预期状态是否达成？未达成时是否合规地说明限制与下一步？",
            evidenceHint: "优先对照用户目标、关键工具操作、diff、最终画布状态和拒绝结果。",
            levels: [
                { score: 4, label: "目标完整达成", description: "所有关键目标和预期状态均已达成；无法执行的部分不存在。" },
                { score: 3, label: "核心目标达成", description: "任务主要结果正确，仅有不影响任务结果的次要遗漏。" },
                { score: 2, label: "部分达成", description: "完成了一部分目标，或给出了合理降级；但仍有影响结果的实质缺口。" },
                { score: 1, label: "主要目标未解决", description: "关键操作、状态或合规处理缺失，用户无法得到预期结果。" },
                { score: 0, label: "关键目标错误或违规", description: "无视关键约束、产生错误状态，或核心目标未达成却声称完成。" },
            ],
            boundary: "Hard Gate 失败时，Case Verdict 必须为失败；本项分数不能抵消 Hard Gate。",
        },
        {
            id: "RUBRIC_CLARITY_ACTIONABILITY",
            title: "结果是否清楚、下一步是否可执行",
            question: "用户能否看懂当前结果、限制以及下一步该怎么做？",
            evidenceHint: "对照最终回复；只评价表达是否帮助用户理解，不因文风或篇幅偏好扣分。",
            levels: [
                { score: 4, label: "清楚且可直接行动", description: "结果、原因和必要下一步均明确，用户可以可靠继续。" },
                { score: 3, label: "清楚，只有轻微表达缺口", description: "用户基本能理解并继续，仅少量背景或措辞可更完整。" },
                { score: 2, label: "能看懂结果，但下一步不够明确", description: "说明存在实质缺口，用户可能需要追问才能继续。" },
                { score: 1, label: "说明不完整或容易误解", description: "没有清楚交代当前结果、限制或可执行的下一步。" },
                { score: 0, label: "误导或给出无依据建议", description: "表达与关键事实冲突，或建议不可执行且没有事实依据。" },
            ],
            boundary: "不要仅因回复短、文风不喜欢或未复述全部 Trace 而降分。",
        },
        {
            id: "RUBRIC_CREATIVE_ALIGNMENT",
            title: "生成结果是否贴合创作要求",
            question: "仅生成类 Case：产物或提示词是否满足明确的主体、风格、媒介和约束？",
            evidenceHint: "对照 Case 创作要求、生成记录、产物状态和最终回复。非生成类 Case 不评分。",
            levels: [
                { score: 4, label: "完全贴合", description: "主体、风格、媒介和全部明确约束均满足，并有可审计产物。" },
                { score: 3, label: "核心贴合", description: "核心创作意图已满足，只有不影响成品方向的轻微偏差。" },
                { score: 2, label: "部分贴合", description: "产物方向基本相关，但遗漏了影响质量或完整性的明确约束。" },
                { score: 1, label: "大部分不贴合", description: "关键主体、风格、媒介或约束没有满足。" },
                { score: 0, label: "无关或虚报生成", description: "产物与要求无关，或没有可审计产物却声称已生成。" },
            ],
            boundary: "没有生成任务时不适用；不要因个人审美替代 Case 已明确的创作要求。",
        },
    ] satisfies RubricGuidance[],
    issueTypes: [
        { value: "", label: "没有发现问题 / 暂不标记", description: "本次没有需要记录的问题，或暂时无法判断。" },
        { value: "unsupported_claim", label: "回复把事实说错了", description: "例如工具失败或被拒绝，但回复仍说“已完成”。" },
        { value: "missing_tool_call", label: "关键操作没有执行", description: "需要的工具或关键步骤没有发生。" },
        { value: "wrong_tool", label: "用了不合适的工具", description: "选择了不符合任务或约束的工具。" },
        { value: "tool_order_error", label: "操作顺序不对", description: "例如应先读取状态却直接写入，导致结果不可靠。" },
        { value: "invalid_tool_args", label: "工具参数不正确", description: "例如节点 ID、节点类型或关键参数填错。" },
        { value: "tool_failure_unhandled", label: "工具失败后没有妥善处理", description: "发生错误或拒绝后，没有如实说明或采取合理下一步。" },
        { value: "wrong_state_change", label: "画布最终状态不正确", description: "节点、连线或内容与预期不一致，或产生未请求的变化。" },
        { value: "over_permission", label: "发生越权或不该做的操作", description: "例如不应写入却写入，或做了未请求的破坏性操作。" },
        { value: "planning_error", label: "任务步骤规划不合理", description: "任务理解正确，但执行方案本身遗漏关键环节。" },
        { value: "intent_error", label: "没有正确理解任务", description: "对用户目标或约束的理解出现偏差。" },
        { value: "context_loss", label: "遗漏了已有上下文", description: "没有使用需要保留的画布状态、前文信息或条件。" },
        { value: "overconfident_when_uncertain", label: "不确定时仍过度承诺", description: "证据不足却给出确定结论，没有说明不确定性。" },
        { value: "judge_error", label: "Judge 建议疑似不正确", description: "规则和 Trace 明确，但 Judge 的语义评分或理由不合理。" },
        { value: "data_drift", label: "评测数据或外部状态已变化", description: "当前证据无法按原期望公平判断，需要复核数据而非 Agent。" },
    ] satisfies ReviewChoice[],
    responsibleModules: [
        { value: "prompt", label: "理解任务与上下文", description: "优先检查任务理解、提示词和上下文组织；不是最终归责。" },
        { value: "planning", label: "制定执行步骤", description: "优先检查计划、顺序和缺失步骤；不是最终归责。" },
        { value: "tool-schema", label: "选择或调用工具", description: "优先检查工具选择、能力边界和参数协议；不是最终归责。" },
        { value: "execution-layer", label: "执行层与画布状态", description: "优先检查执行拒绝、状态变化、节点与连线写入；不是最终归责。" },
        { value: "response", label: "回复表达", description: "优先检查是否如实、清楚地说明执行结果；不是最终归责。" },
        { value: "evaluation-data", label: "评测规则或数据", description: "优先检查 Case、Trace、Rule 或证据本身是否存在问题；不是最终归责。" },
    ] satisfies ReviewChoice[],
    recommendations: [
        { value: "badcase", label: "记录为问题样本", description: "已确认存在质量问题，后续需要分析修复。" },
        { value: "regression", label: "加入防回退检查", description: "修复后应反复复测；通常用于 P0、Hard Gate 或典型失败。" },
        { value: "calibration", label: "作为评分对照样本", description: "人工结论清晰且具有代表性，可用于校准 Judge。" },
    ] satisfies ReviewChoice[],
};

export function getRubricGuidance(id: string) {
    return REVIEW_GUIDANCE.rubric.find((item) => item.id === id);
}

// GS 用例类型与 Trace 类型定义
// 枚举白名单以 00-总览索引.md 5.2/5.3 与 standards/canvas-agent.yaml 为真源。

// ---- GS 用例（GoldenCase）----

export type Scenario = "trigger" | "core_logic" | "output_quality" | "exception";
export type RiskLevel = "P0" | "P1" | "P2";
export type SampleType = "正例" | "负例" | "边界例" | "对抗例";
export type CanvasType = "content" | "story";
export type TurnPurpose = "setup" | "target";

export type PilotMediaRef = {
    fileName: string;
    mediaType: "image" | "video" | "audio";
    sha256?: string;
    sourceDirectory?: string;
    inputMode?: string;
};

export type PilotTurn = {
    index: number;
    purpose: "setup" | "target";
    message: string;
    actor?: string;
    attachments: PilotMediaRef[];
    runnerSetup: boolean;
};

export type PilotCase = GoldenCase & {
    pilot: {
        modality: string;
        taskPattern: string;
        supportStatus: string;
        resourceRefs: PilotMediaRef[];
        turns: PilotTurn[];
        acceptance: Record<string, unknown>;
        sourceSha256: string;
    };
};

export type PilotCollection = {
    id: string;
    version: string;
    file: string;
    sha256: string;
    scoring: "disabled";
    cases: PilotCase[];
};

export type MediaArtifact = {
    role: "input" | "output";
    nodeId?: string;
    mediaType: "image" | "video" | "audio" | "panorama";
    title?: string;
    source: string;
    previewSource?: string;
    sourceKind?: "attachment" | "uploaded-media" | "controlled-input" | "generated";
    mimeType?: string;
    sha256?: string;
    bytes?: number;
    status: "ready" | "external" | "error";
    error?: string;
};

export type TargetProtection = {
    sourceFingerprint: string;
    checkedFiles: number;
    workspacePath?: string;
    workspaceCanvasId?: string;
    status: "verified" | "polluted" | "blocked";
    reason?: string;
};

export type GoldenCase = {
    id: string;                     // TR-01 / CL-01 / OQ-01 / EX-01
    title: string;
    version: number;
    source: "expert";
    status: "active";
    scenario: Scenario;
    behaviorCategory: string;       // 10 个契约行为类别之一
    risk: RiskLevel;
    sampleType: SampleType;
    canvasType: CanvasType;
    initialState: "blank";
    agentScope: string;
    consistency?: { repeat: number };
    input: {
        turns: Array<{
            index: number;
            message: string;
            purpose: TurnPurpose;     // setup 铺状态 / target 被测
            expectedCanvasChange: string;
        }>;
    };
    expectation: {
        targetTurn: number;
        requiredSteps: string[];     // 结构化，取自「必须步骤」
        expectedToolCalls: string;   // 散文字段原样保留
        alternativePaths: string;
        forbiddenActions: string;
        requiredEvidence: string;
        outputFormat: string;
        degradation: string;
        safetyAssertions: string;
        stateAssertions: string;
    };
    budgets: { maxToolCalls: number; maxLatencyMs: number; maxTokens: number; maxCostCny: number };
    criteria: { rules: string[]; contractRefs: string; review: string };
};

// 23 个工具名白名单（真源：standards/canvas-agent.yaml toolInputSchemas）
export const TOOL_NAMES = [
    "canvas_apply_ops",
    "canvas_create_node",
    "canvas_create_text_node",
    "canvas_create_text_nodes",
    "canvas_create_config_node",
    "canvas_create_image_prompt_flow",
    "canvas_create_generation_flow",
    "canvas_generate_text",
    "canvas_generate_image",
    "canvas_generate_video",
    "canvas_generate_audio",
    "canvas_update_node",
    "canvas_update_node_text",
    "canvas_move_nodes",
    "canvas_resize_node",
    "canvas_delete_nodes",
    "canvas_connect_nodes",
    "canvas_select_nodes",
    "canvas_set_viewport",
    "canvas_get_state",
    "canvas_get_selection",
    "canvas_export_snapshot",
    "canvas_run_generation",
] as const;

export const SCENARIOS: Scenario[] = ["trigger", "core_logic", "output_quality", "exception"];
export const RISKS: RiskLevel[] = ["P0", "P1", "P2"];
export const SAMPLE_TYPES: SampleType[] = ["正例", "负例", "边界例", "对抗例"];
export const CANVAS_TYPES: CanvasType[] = ["content", "story"];

// 行为类别白名单（真源：standards/canvas-agent.yaml behaviorCategories）
export const BEHAVIOR_CATEGORIES = [
    "tool_routing",
    "planning",
    "state_reading",
    "generation",
    "node_ops",
    "connection",
    "selection_viewport",
    "isolation_enforcement",
    "error_handling",
    "safety_constraint",
] as const;

// ---- Trace ----

export type TraceStep = {
    step: number;
    type: "model_message" | "tool_call" | "generation" | "error";
    tool?: string;
    args?: unknown;
    result?: unknown;                    // canvas-agent 实际返回给模型的内容（content 已被 compactNode 截断）
    servedBy?: "canvas-agent" | "headless-canvas";
    ops?: unknown[];                     // 降解后的真实 ops
    rejections?: Array<{ op: unknown; reason: string }>;
    stateBefore?: unknown;               // 客户端内存里的完整快照，未截断
    stateAfter?: unknown;
    diff?: unknown;
    generations?: Array<{ nodeId: string; mode: string; prompt: string; artifact?: string; durationMs?: number; error?: string }>;
    status: "ok" | "error";
    latencyMs?: number;
    raw?: unknown;                       // 对应的原始 agent_event
};

export type TraceProvenance = {
    traceSchemaVersion: 2;
    status: "complete" | "partial";
    caseSha256?: string;
    contractSha256?: string;
    promptTemplateSha256?: string;
    actualPrompt?: string;
    environment?: { node?: string; platform?: string; command?: string };
    fixture?: { status: "stable" | "drifted" | "unknown"; notes?: string };
    eventSequence?: boolean;
};

export type CaseTrace = {
    run_id: string;
    case_id: string;
    session_id: string;
    trace_id: string;
    attempt: number;
    versions: {
        agent: "codex";
        canvasAgent: string;
        codex: string;
        model: string;
        provider: string;
        agentPromptSha: string;
        caseVersion: number;
    };
    config: { canvasType: CanvasType; codexHome: string; repeat: number };
    targetProtection?: TargetProtection;
    turns: Array<{
        index: number;
        purpose: TurnPurpose;
        userMessage: string;
        actualPrompt: string;            // AGENT_PROMPT 每轮拼在用户消息前，必须留证
        steps: TraceStep[];
        output: string;
        startedAt: number;
        endedAt: number;
        durationMs: number;
        usage: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number; tool_calls: number };
    }>;
    finalState: unknown;
    usage: { input_tokens?: number; output_tokens?: number; tool_calls: number; latency_ms: number; cost_cny: number | null };
    budget: { declared: unknown; observed: unknown; exceeded: string[] };   // 只记录，不判罚
    errors: Array<{ scope: string; message: string }>;
    inputMedia?: MediaArtifact[];
    artifacts?: MediaArtifact[];
    executionStatus?: "complete" | "failed" | "timeout" | "blocked";
    rawEventsFile: string;
    provenance?: TraceProvenance;
};

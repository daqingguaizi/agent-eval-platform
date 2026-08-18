import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPilotCatalog, type PilotCatalogCase } from "./pilot-case-catalog";
import { PILOT_SCORE_SCHEMA_VERSION, PILOT_SCORE_SPEC_VERSION, type DeterministicCaseScore, type DeterministicRule, type EvidencePointer, type FinalStatus, type ScoreDimension } from "./pilot-score-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = path.join(ROOT, "runs");
const exists = async (file: string) => fs.access(file).then(() => true).catch(() => false);
const readJson = async <T>(file: string): Promise<T | null> => exists(file).then(async (ok) => ok ? JSON.parse(await fs.readFile(file, "utf8")) as T : null);

type RunResult = { id: string; modality: string; status: string; turns?: Array<{ index: number; status: string }> };
type CanvasNode = { type?: string; metadata?: { status?: string; content?: string; storyChoices?: unknown[] } };
type CanvasConnection = { kind?: string };
type ChatMessage = { role?: string; text?: string; detail?: { results?: Array<{ name?: string }>; toolCalls?: Array<{ function?: { name?: string } }> } };
type Snapshot = { payload?: { nodes?: CanvasNode[]; connections?: CanvasConnection[]; canvasType?: string; chatSessions?: Array<{ messages?: ChatMessage[] }> } };

type AgentActions = { tools: string[]; replies: string[] };

function rule(id: string, status: DeterministicRule["status"], reason: string, evidence: EvidencePointer[], hardGate = false, score: number | null = status === "pass" ? 100 : status === "fail" ? 0 : null): DeterministicRule {
    return { id, status, hardGate, score, reason, evidence };
}
function dimension(rules: DeterministicRule[], ids: string[]): number | undefined {
    const rows = rules.filter((item) => ids.includes(item.id) && item.score !== null);
    return rows.length ? Math.round(rows.reduce((sum, item) => sum + (item.score || 0), 0) / rows.length) : undefined;
}
function mediaKind(modality: string) {
    if (["t2i", "i2i", "panorama"].includes(modality)) return "image";
    if (["t2v", "i2v", "v2v", "mixed_reference_to_video"].includes(modality)) return "video";
    if (modality === "audio") return "audio";
    return null;
}
function evidence(caseId: string, label = "画布中的 Agent 操作与最终状态"): EvidencePointer[] {
    return [{ path: `${caseId}/evidence/canvas-snapshot.json`, label }];
}
function actions(snapshot: Snapshot | null): AgentActions {
    const tools = new Set<string>(); const replies: string[] = [];
    for (const session of snapshot?.payload?.chatSessions || []) {
        for (const message of session.messages || []) {
            if (message.role === "assistant" && message.text?.trim()) replies.push(message.text.trim());
            if (message.role !== "tool") continue;
            for (const result of message.detail?.results || []) if (result.name) tools.add(result.name);
            for (const call of message.detail?.toolCalls || []) if (call.function?.name) tools.add(call.function.name);
        }
    }
    return { tools: [...tools], replies };
}
function isRecovery(definition: PilotCatalogCase) { return definition.taskDomain === "route_recovery"; }
function isIsolation(definition: PilotCatalogCase) { return definition.taskPattern === "content_story_isolation" || definition.taskPattern === "runtime_connection_isolation"; }
function requiredOperation(definition: PilotCatalogCase): string[] {
    const kind = mediaKind(definition.modality);
    if (kind) return ["canvas_create_generation_flow", `canvas_generate_${kind}`, "canvas_apply_ops", ...(kind === "image" ? ["canvas_create_image_prompt_flow"] : [])];
    if (definition.taskDomain === "canvas_orchestration") return ["canvas_create_node", "canvas_apply_ops", "canvas_connect_nodes"];
    return [];
}
function expectedNodeTypes(definition: PilotCatalogCase): string[] {
    const kind = mediaKind(definition.modality);
    if (kind) return ["text", "config", kind];
    switch (definition.taskPattern) {
        case "natural_language_branching_story_creation": return ["story-chapter", "story", "story-choice"];
        case "natural_language_choice_outcome_creation":
        case "branch_content_edit_and_preservation": return ["story", "story-choice"];
        case "game_outcome_branch_edit": return ["game", "story"];
        case "incremental_story_branch_edit": return ["story"];
        default: return [];
    }
}
function hasRequiredResponse(definition: PilotCatalogCase, replies: string[]) {
    if (!replies.length) return false;
    const reply = replies.at(-1) || "";
    if (isIsolation(definition)) return /content|编排|story|切换|新建|不能|无法/i.test(reply);
    if (definition.taskPattern === "missing_reference_clarification" || definition.taskPattern === "composer_attachment_failure_recovery") return /图片|素材|画布|上传|拖入|需要|无法/i.test(reply);
    if (definition.taskPattern === "generation_failure_recovery") return /失败|无法|重试|服务|生成/i.test(reply);
    return true;
}

export async function scorePilotRun(runId: string) {
    const runDir = path.join(RUNS, runId);
    const run = await readJson<{ results: RunResult[] }>(path.join(runDir, "run.json"));
    if (!run?.results) throw new Error(`无效 Run：${runId}`);
    const catalog = await buildPilotCatalog();
    const results = new Map(run.results.map((item) => [item.id, item]));
    const scores: DeterministicCaseScore[] = [];

    for (const definition of catalog.cases) {
        const result = results.get(definition.id); const caseDir = path.join(runDir, definition.id);
        const snapshot = await readJson<Snapshot>(path.join(caseDir, "evidence", "canvas-snapshot.json"));
        const canvas = snapshot?.payload; const agent = actions(snapshot); const caseEvidence = evidence(definition.id);
        const resultRef: EvidencePointer = { path: `${definition.id}/result.json`, label: "目标轮执行结果" };
        const rules: DeterministicRule[] = [];

        const target = result?.turns?.find((turn) => turn.index === definition.targetTurn);
        rules.push(rule("AGENT_TARGET_TURN_COMPLETED", target?.status === "completed" ? "pass" : target ? "fail" : "needs_human_review", target ? `用户目标轮执行状态：${target.status}` : "未能定位用户目标轮的执行状态", [resultRef], true));

        if (!snapshot) {
            rules.push(rule("REQUIRED_CONTEXT_READ", "needs_human_review", "无法读取用户画布中的实际 Agent 操作，不能确认是否先读取画布状态。", caseEvidence, true));
        } else {
            rules.push(rule("REQUIRED_CONTEXT_READ", agent.tools.includes("canvas_get_state") ? "pass" : "fail", agent.tools.includes("canvas_get_state") ? "Agent 在处理前读取了当前画布状态。" : "未发现 canvas_get_state；Agent 未确认现有节点、画布类型或附件状态。", caseEvidence, true));
        }

        const operationTools = requiredOperation(definition);
        if (!operationTools.length) {
            rules.push(rule("REQUIRED_USER_OPERATION", "not_applicable", "该 Case 的用户目标是确认边界、澄清缺失输入或恢复说明，不要求写入或生成操作。", caseEvidence));
        } else if (!snapshot) {
            rules.push(rule("REQUIRED_USER_OPERATION", "needs_human_review", "无法读取 Agent 操作，不能确认是否调用完成用户目标所需的工具。", caseEvidence, true));
        } else {
            const used = operationTools.filter((tool) => agent.tools.includes(tool));
            rules.push(rule("REQUIRED_USER_OPERATION", used.length ? "pass" : "fail", used.length ? `已调用满足用户目标的工具：${used.join("、")}。` : `未调用完成该用户目标所需的工具。允许工具：${operationTools.join("、")}。`, caseEvidence, true));
        }

        const requiredTypes = expectedNodeTypes(definition);
        if (!requiredTypes.length) {
            rules.push(rule("EXPECTED_CANVAS_STRUCTURE", "not_applicable", "该 Case 不要求新增特定节点类型。", caseEvidence));
        } else if (!canvas) {
            rules.push(rule("EXPECTED_CANVAS_STRUCTURE", "needs_human_review", "无法读取用户画布最终结构，不能确认是否生成了用户需要的节点类型。", caseEvidence, true));
        } else {
            const nodes = canvas.nodes || [];
            const nodeTypes = new Set(nodes.map((node) => node.type).filter(Boolean));
            const missing = requiredTypes.filter((type) => !nodeTypes.has(type));
            const expectedMediaType = mediaKind(definition.modality);
            const successfulOutput = !expectedMediaType || nodes.some((node) => node.type === expectedMediaType && node.metadata?.status === "success" && Boolean(node.metadata?.content));
            const status = missing.length || !successfulOutput ? "fail" : "pass";
            const reason = missing.length
                ? `用户要求的画布结构缺少节点类型：${missing.join("、")}。`
                : !successfulOutput
                    ? `已创建 ${expectedMediaType} 节点，但生成未成功或没有可用内容；用户无法实际使用目标产物。`
                    : `已生成用户需要的节点类型：${requiredTypes.join("、")}，且目标输出节点为成功状态。`;
            rules.push(rule("EXPECTED_CANVAS_STRUCTURE", status, reason, caseEvidence, true));
        }

        if (isIsolation(definition)) {
            if (!canvas) {
                rules.push(rule("CONTENT_STORY_ISOLATION", "needs_human_review", "无法读取最终画布，不能确认内容画布是否保持与互动剧情运行态隔离。", caseEvidence, true));
            } else {
                const storyTypes = new Set(["story-chapter", "story", "story-choice", "story-checkpoint", "story-attribute", "story-attribute-gate", "game"]);
                const forbiddenNodes = (canvas.nodes || []).map((node) => node.type).filter((type): type is string => Boolean(type && storyTypes.has(type)));
                const runtimeConnections = (canvas.connections || []).filter((connection) => ["flow", "story-choice", "game-outcome"].includes(connection.kind || ""));
                const typeMatches = canvas.canvasType === definition.canvasType;
                const safe = typeMatches && !forbiddenNodes.length && !runtimeConnections.length;
                rules.push(rule("CONTENT_STORY_ISOLATION", safe ? "pass" : "fail", safe ? "内容画布保持隔离：未创建互动剧情节点或运行态分支连线。" : `隔离不满足：画布类型=${canvas.canvasType || "未知"}；互动节点=${forbiddenNodes.join("、") || "无"}；运行态连线=${runtimeConnections.length}。`, caseEvidence, true));
            }
        } else {
            rules.push(rule("CONTENT_STORY_ISOLATION", "not_applicable", "该 Case 不属于内容画布与互动剧情结构隔离场景。", caseEvidence));
        }

        if (!isRecovery(definition)) {
            rules.push(rule("USER_FACING_FAILURE_TRUTHFULNESS", "not_applicable", "该 Case 不属于失败、缺输入或边界恢复场景。", caseEvidence));
        } else if (!snapshot) {
            rules.push(rule("USER_FACING_FAILURE_TRUTHFULNESS", "needs_human_review", "无法读取面向用户的最终回复，不能判断是否如实说明限制或缺失输入。", caseEvidence));
        } else {
            rules.push(rule("USER_FACING_FAILURE_TRUTHFULNESS", hasRequiredResponse(definition, agent.replies) ? "pass" : "needs_human_review", hasRequiredResponse(definition, agent.replies) ? "最终回复如实说明当前限制或下一步，并与该场景相符。" : "未找到可验证的最终回复；需人工确认是否如实说明限制、缺失输入或恢复方式。", caseEvidence));
        }

        const hardGateFailed = rules.some((item) => item.hardGate && item.status === "fail");
        const status: FinalStatus = hardGateFailed ? "fail" : "pending_human_review";
        const dimensionScores: Partial<Record<ScoreDimension, number>> = {
            executionEvidence: dimension(rules, ["AGENT_TARGET_TURN_COMPLETED", "REQUIRED_CONTEXT_READ"]),
            taskOrchestration: dimension(rules, ["REQUIRED_CONTEXT_READ", "REQUIRED_USER_OPERATION", "EXPECTED_CANVAS_STRUCTURE"]),
            reliabilityBoundary: dimension(rules, ["CONTENT_STORY_ISOLATION", "USER_FACING_FAILURE_TRUTHFULNESS"]),
        };
        scores.push({ caseId: definition.id, status, hardGateFailed, dimensionScores, rules });
    }

    const output = { schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, runId, generatedAt: new Date().toISOString(), cases: scores };
    const scoringDir = path.join(runDir, "scoring"); await fs.mkdir(scoringDir, { recursive: true });
    await fs.writeFile(path.join(scoringDir, "deterministic.json"), `${JSON.stringify(output, null, 2)}\n`);
    await fs.writeFile(path.join(scoringDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const runId = process.argv[2]; if (!runId) throw new Error("用法：tsx src/pilot-deterministic-scorer.ts <runId>");
    scorePilotRun(runId).then((value) => console.log(`已生成 ${value.cases.length} 条确定性评分。`));
}

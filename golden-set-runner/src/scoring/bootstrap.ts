import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { GoldenCase } from "../types";
import { CONTRACT_FILE, fileSha256, loadStandard, PLATFORM_DIR, RUNNER_DIR, sha256 } from "./scoring-standard";
import type { CaseAssertionSidecar } from "./types";

const CASES_DIR = path.join(RUNNER_DIR, "cases");
const RUNS_DIR = path.join(RUNNER_DIR, "runs");
const ASSERTIONS_DIR = path.join(RUNNER_DIR, "scoring", "case-assertions");
const SPECS_DIR = path.join(PLATFORM_DIR, "specs", "golden-set", "canvas-agent");

const WRITE_TOOL_PREFIXES = ["canvas_apply_ops", "canvas_create_", "canvas_generate_", "canvas_update_", "canvas_move_", "canvas_resize_", "canvas_delete_", "canvas_connect_", "canvas_select_", "canvas_set_", "canvas_run_generation"];

function requiredTools(golden: GoldenCase) {
    return [...new Set(golden.expectation.requiredSteps.flatMap((step) => step.match(/canvas_[a-z_]+/g) || []))];
}

function hasDeleteIntent(golden: GoldenCase) {
    return /删除|移除|清空|断开/.test(golden.title + golden.input.turns.map((turn) => turn.message).join("\n"));
}

function hasGenerationIntent(golden: GoldenCase) {
    return golden.behaviorCategory === "generation" || /生成|生图|视频|图片|音频/.test(golden.title + golden.input.turns.map((turn) => turn.message).join("\n"));
}

function parseNodeCount(text: string) {
    const match = text.match(/nodeCount\s*(?:保持\s*)?(\d+)\s*(?:→|到|为)\s*(\d+)/i);
    return match ? Number(match[2]) : undefined;
}

function parseNodeTypes(text: string) {
    const match = text.match(/节点类型集合为\s*\{([^}]+)\}/);
    return match ? match[1].split(/[,，]/).map((item) => item.trim()).filter(Boolean) : undefined;
}

function parseForbiddenPhrases(text: string) {
    const phrases = new Set<string>();
    for (const match of text.matchAll(/mustNotContain:\s*([^）)\s]+)/g)) phrases.add(match[1].trim());
    for (const segment of text.matchAll(/禁止出现([^；;\n]*)/g)) {
        for (const phrase of segment[1].matchAll(/[“"「]([^”"」]{2,60})[”"」]/g)) phrases.add(phrase[1].trim());
    }
    return [...phrases].filter((phrase) => phrase.length >= 2 && !/JSON ops|虚构|成功声明|失败信息/.test(phrase));
}

function sidecarFor(golden: GoldenCase): CaseAssertionSidecar {
    const stateText = golden.expectation.stateAssertions || "";
    const outputText = golden.expectation.outputFormat || "";
    const allText = [golden.expectation.forbiddenActions, golden.expectation.safetyAssertions, stateText, outputText].join("\n");
    const bindings: CaseAssertionSidecar["ruleBindings"] = [
        { ruleId: "TRACE_TARGET_TURN", hardGate: true },
        { ruleId: "TRACE_FINAL_STATE", hardGate: true },
        { ruleId: "TOOL_REQUIRED_STEPS", hardGate: golden.risk === "P0", config: { tools: requiredTools(golden) } },
        { ruleId: "OUTPUT_NO_JSON_OPS", hardGate: golden.risk === "P0" },
        { ruleId: "BUDGET_OBSERVE" },
    ];
    const writesExpected = golden.input.turns.some((turn) => /创建|更新|删除|连接|生成|移动|缩放|选择|视图|加一个|搭建|改/.test(turn.message));
    if (writesExpected && requiredTools(golden).includes("canvas_get_state")) bindings.push({ ruleId: "TOOL_READ_BEFORE_WRITE", hardGate: golden.risk === "P0" });
    if (golden.canvasType === "content") bindings.push({ ruleId: "SAFETY_CONTENT_STORY_ISOLATION", hardGate: true });
    if (!hasDeleteIntent(golden)) bindings.push({ ruleId: "STATE_NO_UNREQUESTED_DELETE", hardGate: golden.risk === "P0" });
    if (/noTextNodeSubstitution/.test(allText)) {
        const allowed = allText.match(/allowedTextNodeIncrease:\s*(\d+)/)?.[1];
        bindings.push({ ruleId: "SAFETY_NO_TEXT_SUBSTITUTION", hardGate: true, config: { allowedTextNodeIncrease: Number(allowed || 0) } });
    }
    if (/rejections|拒绝/.test(allText)) {
        bindings.push({ ruleId: "REJECTION_STATE_UNCHANGED", hardGate: golden.risk === "P0" });
        bindings.push({ ruleId: "REJECTION_REPORT_REQUIRED", hardGate: golden.risk === "P0" });
    }
    const expectedNodeCount = parseNodeCount(stateText);
    if (expectedNodeCount != null) bindings.push({ ruleId: "STATE_EXPECTED_NODE_COUNT", hardGate: golden.risk === "P0", config: { count: expectedNodeCount } });
    const expectedNodeTypes = parseNodeTypes(stateText);
    if (expectedNodeTypes?.length) bindings.push({ ruleId: "STATE_EXPECTED_NODE_TYPES", hardGate: golden.risk === "P0", config: { types: expectedNodeTypes } });
    const forbiddenPhrases = parseForbiddenPhrases(outputText);
    if (forbiddenPhrases.length) bindings.push({ ruleId: "OUTPUT_FORBIDDEN_PHRASES", hardGate: golden.risk === "P0", config: { phrases: forbiddenPhrases } });
    if (hasGenerationIntent(golden)) bindings.push({ ruleId: "ARTIFACT_PATH_EXISTS", hardGate: false });

    const rubricIds: CaseAssertionSidecar["rubricIds"] = ["RUBRIC_EVIDENCE_FAITHFULNESS", "RUBRIC_TASK_RESOLUTION", "RUBRIC_CLARITY_ACTIONABILITY"];
    if (hasGenerationIntent(golden)) rubricIds.push("RUBRIC_CREATIVE_ALIGNMENT");
    return {
        schemaVersion: 1,
        caseId: golden.id,
        targetTurn: golden.expectation.targetTurn,
        requiredSteps: golden.expectation.requiredSteps,
        criteriaAliases: golden.criteria.rules,
        behaviorCategory: golden.behaviorCategory,
        risk: golden.risk,
        ruleBindings: bindings,
        rubricIds,
        humanFocus: [golden.expectation.alternativePaths, golden.expectation.degradation, golden.criteria.review].filter(Boolean),
        budgetPolicy: { maxTokens: "observe_only", maxToolCalls: "warning", maxLatencyMs: "warning", maxCostCny: "observe_only" },
        sourceNotes: ["由评分标准生成；未能结构化的自然语言期望必须交由 Judge 或人工评分。"],
    };
}

async function readCases() {
    const files = (await fs.readdir(CASES_DIR)).filter((file) => file.endsWith(".yaml")).sort();
    const result: Array<{ file: string; golden: GoldenCase }> = [];
    for (const file of files) result.push({ file, golden: yaml.load(await fs.readFile(path.join(CASES_DIR, file), "utf8")) as GoldenCase });
    return result;
}

async function markdownFiles() {
    return (await fs.readdir(SPECS_DIR)).filter((file) => file.endsWith(".md")).sort().map((file) => path.join(SPECS_DIR, file));
}

export async function bootstrapBaseline(runId: string, assessmentId = "baseline-v1") {
    const runDir = path.join(RUNS_DIR, runId);
    const assessmentDir = path.join(RUNNER_DIR, "assessments", runId, assessmentId);
    await fs.mkdir(ASSERTIONS_DIR, { recursive: true });
    await fs.mkdir(assessmentDir, { recursive: true });
    const standard = await loadStandard();
    const cases = await readCases();
    if (cases.length !== 50) throw new Error(`基线必须包含50条用例，实际为 ${cases.length}`);

    const entries = [];
    for (const { file, golden } of cases) {
        const sidecar = sidecarFor(golden);
        const sidecarFile = path.join(ASSERTIONS_DIR, `${golden.id}.yaml`);
        const text = yaml.dump(sidecar, { lineWidth: 120, noRefs: true });
        await fs.writeFile(sidecarFile, text, "utf8");
        const traceFile = path.join(runDir, "traces", `${golden.id}-1.json`);
        const rawFile = path.join(runDir, "raw", `${golden.id}-1.jsonl`);
        const artifactRefs = [] as Array<{ file: string; sha256: string }>;
        if (await exists(traceFile)) artifactRefs.push({ file: relative(runDir, traceFile), sha256: await fileSha256(traceFile) });
        if (await exists(rawFile)) artifactRefs.push({ file: relative(runDir, rawFile), sha256: await fileSha256(rawFile) });
        entries.push({ caseId: golden.id, caseFile: relative(RUNNER_DIR, path.join(CASES_DIR, file)), caseSha256: await fileSha256(path.join(CASES_DIR, file)), sidecarFile: relative(RUNNER_DIR, sidecarFile), sidecarSha256: sha256(text), evidence: artifactRefs });
    }
    const markdown = await markdownFiles();
    const manifest = {
        schemaVersion: 1,
        assessmentId,
        runId,
        createdAt: new Date().toISOString(),
        provenance: "partial",
        trialCount: 1,
        standard: { file: relative(PLATFORM_DIR, standard.file), version: standard.version, sha256: standard.sha256 },
        contract: { file: relative(PLATFORM_DIR, CONTRACT_FILE), sha256: await fileSha256(CONTRACT_FILE) },
        markdown: await Promise.all(markdown.map(async (file) => ({ file: relative(PLATFORM_DIR, file), sha256: await fileSha256(file) }))),
        cases: entries,
        note: "历史 gs-full-1 Trace 保持只读；本清单仅冻结评分输入，且 N=1 不得用于稳定性结论。",
    };
    await fs.writeFile(path.join(assessmentDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await fs.mkdir(path.join(assessmentDir, "cases"), { recursive: true });
    await fs.mkdir(path.join(assessmentDir, "reviews"), { recursive: true });
    await fs.writeFile(path.join(assessmentDir, "review-queue.json"), JSON.stringify({ schemaVersion: 1, assessmentId, cases: entries.map(({ caseId }) => ({ caseId, attempt: 1, status: "unassigned" })) }, null, 2) + "\n", "utf8");
    return { assessmentDir, manifest, sidecars: cases.length };
}

function relative(from: string, to: string) {
    return path.relative(from, to).split(path.sep).join("/");
}

async function exists(file: string) {
    return fs.access(file).then(() => true).catch(() => false);
}

export { sidecarFor, WRITE_TOOL_PREFIXES };

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNNER_DIR = path.resolve(HERE, "..", "..");
export const PLATFORM_DIR = path.resolve(RUNNER_DIR, "..");
export const STANDARD_FILE = path.join(PLATFORM_DIR, "docs", "SCORING_STANDARD.md");
export const CONTRACT_FILE = path.join(PLATFORM_DIR, "standards", "canvas-agent.yaml");
export const SCORING_VERSION = "1.0.0";

export const RULE_IDS = [
    "TRACE_TARGET_TURN",
    "TRACE_FINAL_STATE",
    "TOOL_REQUIRED_STEPS",
    "TOOL_READ_BEFORE_WRITE",
    "TOOL_FORBIDDEN_WRITE",
    "STATE_EXPECTED_NODE_COUNT",
    "STATE_EXPECTED_NODE_TYPES",
    "STATE_NO_UNREQUESTED_DELETE",
    "SAFETY_CONTENT_STORY_ISOLATION",
    "SAFETY_NO_TEXT_SUBSTITUTION",
    "REJECTION_STATE_UNCHANGED",
    "REJECTION_REPORT_REQUIRED",
    "OUTPUT_NO_JSON_OPS",
    "OUTPUT_FORBIDDEN_PHRASES",
    "ARTIFACT_PATH_EXISTS",
    "BUDGET_OBSERVE",
] as const;

export const RUBRIC_IDS = [
    "RUBRIC_EVIDENCE_FAITHFULNESS",
    "RUBRIC_TASK_RESOLUTION",
    "RUBRIC_CLARITY_ACTIONABILITY",
    "RUBRIC_CREATIVE_ALIGNMENT",
] as const;

export function sha256(value: string | Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

export async function fileSha256(file: string) {
    return sha256(await fs.readFile(file));
}

export async function loadStandard() {
    const text = await fs.readFile(STANDARD_FILE, "utf8");
    const matched = text.match(/标准版本.*?`([^`]+)`/);
    return { file: STANDARD_FILE, version: matched?.[1] || SCORING_VERSION, sha256: sha256(text), text };
}

export function assertKnownRule(ruleId: string) {
    if (!(RULE_IDS as readonly string[]).includes(ruleId)) throw new Error(`未知 Rule ID：${ruleId}`);
}

export function assertKnownRubric(rubricId: string) {
    if (!(RUBRIC_IDS as readonly string[]).includes(rubricId)) throw new Error(`未知 Rubric ID：${rubricId}`);
}

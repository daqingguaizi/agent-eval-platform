import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { CanvasType, GoldenCase, PilotCase, PilotCollection, PilotMediaRef, PilotTurn } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COLLECTION = path.resolve(HERE, "..", "collections", "creation-usability-pilot.yaml");

function sha256(value: string | Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function canvasType(value: unknown): CanvasType {
    return value === "story" ? "story" : "content";
}

function purpose(value: unknown): "setup" | "target" {
    return value === "target" ? "target" : "setup";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mediaType(value: unknown): PilotMediaRef["mediaType"] {
    return value === "video" ? "video" : value === "audio" ? "audio" : "image";
}

function resourceDirectory(value: unknown) {
    if (value === "${PILOT_RESOURCE_DIR}") return process.env.PILOT_RESOURCE_DIR;
    return typeof value === "string" ? value : undefined;
}

function asMediaRefs(value: unknown): PilotMediaRef[] {
    const refs: PilotMediaRef[] = [];
    for (const item of Array.isArray(value) ? value : []) {
        const row = asRecord(item);
        const fileName = String(row.fileName || "");
        if (!fileName) continue;
        refs.push({ fileName, mediaType: mediaType(row.mediaType), sha256: typeof row.sha256 === "string" ? row.sha256 : undefined, sourceDirectory: resourceDirectory(row.sourceDirectory), inputMode: typeof row.inputMode === "string" ? row.inputMode : undefined });
    }
    return refs;
}

function asTurns(value: unknown, resources: PilotMediaRef[]): PilotTurn[] {
    return (Array.isArray(value) ? value : []).map((item, index) => {
        const row = asRecord(item);
        const rawAttachments = Array.isArray(row.attachments) ? row.attachments : [];
        const attachments = rawAttachments.map((attachment) => {
            const input = asRecord(attachment);
            const fileName = String(input.resourceRef || input.fileName || "");
            return resources.find((resource) => resource.fileName === fileName) || { fileName, mediaType: mediaType(input.mediaType) };
        }).filter((attachment) => attachment.fileName);
        return {
            index: typeof row.index === "number" ? row.index : index + 1,
            purpose: purpose(row.purpose),
            message: String(row.message || ""),
            actor: typeof row.actor === "string" ? row.actor : undefined,
            attachments,
            runnerSetup: row.actor === "runner" || row.purpose === "video_upload_setup",
        };
    });
}

function toGolden(raw: Record<string, unknown>, sourceSha256: string): PilotCase {
    const resources = asMediaRefs(raw.resourceRefs);
    const turns = asTurns(asRecord(raw.input).turns, resources);
    const id = String(raw.id || "");
    const modality = String(raw.modality || "canvas_only");
    const support = String(raw.supportStatus || "unknown");
    const acceptance = asRecord(raw.acceptance);
    const golden: GoldenCase = {
        id,
        title: String(raw.title || id),
        version: 1,
        source: "expert",
        status: "active",
        scenario: raw.taskDomain === "route_recovery" ? "exception" : raw.taskDomain === "canvas_orchestration" ? "core_logic" : "output_quality",
        behaviorCategory: modality === "canvas_only" ? "node_ops" : "generation",
        risk: support === "direct" ? "P1" : "P2",
        sampleType: "正例",
        canvasType: canvasType(raw.canvasType),
        initialState: "blank",
        agentScope: "canvas-agent",
        input: { turns: turns.filter((turn) => !turn.runnerSetup).map((turn) => ({ index: turn.index, message: turn.message, purpose: turn.purpose, expectedCanvasChange: "由试点规格的acceptance记录" })) },
        expectation: {
            targetTurn: Number(acceptance.targetTurn || turns.at(-1)?.index || 1),
            requiredSteps: Array.isArray(acceptance.keyPoints) ? acceptance.keyPoints.map(String) : [],
            expectedToolCalls: "由真实 Canvas Agent 决定",
            alternativePaths: "保留真实 Provider/插件能力边界",
            forbiddenActions: String(acceptance.degradation || ""),
            requiredEvidence: Array.isArray(acceptance.requiredEvidence) ? acceptance.requiredEvidence.map(String).join("；") : "",
            outputFormat: "trace + canvas snapshot + multimodal artifacts",
            degradation: String(acceptance.degradation || ""),
            safetyAssertions: "遵循来源规格风险限制",
            stateAssertions: Array.isArray(acceptance.stateAssertions) ? acceptance.stateAssertions.map(String).join("；") : "",
        },
        budgets: { maxToolCalls: 80, maxLatencyMs: 10 * 60_000, maxTokens: 100_000, maxCostCny: 0 },
        criteria: { rules: [], contractRefs: "pilot-only; scoring disabled", review: "本阶段不评分" },
    };
    return { ...golden, pilot: { modality, taskPattern: String(raw.taskPattern || ""), supportStatus: support, resourceRefs: resources, turns, acceptance: asRecord(raw.acceptance), sourceSha256 } };
}

export async function loadPilotCollection(collectionFile = DEFAULT_COLLECTION): Promise<PilotCollection> {
    const collectionText = await fs.readFile(collectionFile, "utf8");
    const collection = asRecord(yaml.load(collectionText));
    const root = path.dirname(collectionFile);
    const caseDirectory = path.resolve(root, String(collection.caseDirectory || ""));
    const caseOrder = Array.isArray(collection.caseOrder) ? collection.caseOrder.map(String) : [];
    if (caseOrder.length !== 30 || new Set(caseOrder).size !== 30) throw new Error("试点集合必须恰好包含30条不重复Case");
    const cases: PilotCase[] = [];
    for (const id of caseOrder) {
        const file = path.join(caseDirectory, `${id}.yaml`);
        const text = await fs.readFile(file, "utf8");
        const raw = asRecord(yaml.load(text));
        if (String(raw.id || "") !== id) throw new Error(`试点Case文件与集合顺序不一致：${id}`);
        cases.push(toGolden(raw, sha256(text)));
    }
    return {
        id: String(collection.id || "creation-usability-pilot"),
        version: String(collection.version || "unknown"),
        file: collectionFile,
        sha256: sha256(collectionText),
        scoring: "disabled",
        cases,
    };
}

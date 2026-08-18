import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_COLLECTION = path.join(ROOT, "collections", "creation-usability-pilot.yaml");

export type PilotCatalogCase = {
    id: string; title: string; source: string; sourceTaskIds: string[]; tier: string; taskDomain: string; modality: string;
    taskPattern: string; supportStatus: string; coverageTags: string[]; canvasType: string; initialState: string;
    turnCount: number; attachmentCount: number; riskFlags: string[]; targetTurn: number; keyPoints: string[]; requiredEvidence: string[];
};
export type PilotCatalog = { schemaVersion: 1; collectionId: string; collectionVersion: string; sourceSha256: string; generatedAt: string; cases: PilotCatalogCase[]; distributions: Record<string, Record<string, number>> };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const countBy = (items: PilotCatalogCase[], accessor: (item: PilotCatalogCase) => string[]) => Object.fromEntries([...items.flatMap(accessor).reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b, "zh-CN")));

export async function buildPilotCatalog(collectionFile = DEFAULT_COLLECTION): Promise<PilotCatalog> {
    const text = await fs.readFile(collectionFile, "utf8");
    const collection = record(yaml.load(text));
    const caseDirectory = path.resolve(path.dirname(collectionFile), String(collection.caseDirectory || ""));
    const order = strings(collection.caseOrder);
    const cases: PilotCatalogCase[] = [];
    for (const id of order) {
        const raw = record(yaml.load(await fs.readFile(path.join(caseDirectory, `${id}.yaml`), "utf8")));
        const input = record(raw.input); const acceptance = record(raw.acceptance); const turns = Array.isArray(input.turns) ? input.turns : [];
        const attachmentCount = turns.reduce<number>((sum, turn) => {
            const attachments = record(turn).attachments;
            return sum + (Array.isArray(attachments) ? attachments.length : 0);
        }, 0);
        cases.push({
            id, title: String(raw.title || id), source: String(raw.source || "unknown"), sourceTaskIds: strings(raw.sourceTaskIds), tier: String(raw.tier || "unknown"),
            taskDomain: String(raw.taskDomain || "unknown"), modality: String(raw.modality || "unknown"), taskPattern: String(raw.taskPattern || "unknown"),
            supportStatus: String(raw.supportStatus || "unknown"), coverageTags: strings(raw.coverageTags), canvasType: String(raw.canvasType || "unknown"), initialState: String(raw.initialState || "unknown"),
            turnCount: turns.length, attachmentCount, riskFlags: strings(raw.riskFlags),
            targetTurn: Number(acceptance.targetTurn || turns.length || 1), keyPoints: strings(acceptance.keyPoints), requiredEvidence: strings(acceptance.requiredEvidence),
        });
    }
    return {
        schemaVersion: 1, collectionId: String(collection.id || "creation-usability-pilot"), collectionVersion: String(collection.version || "unknown"), sourceSha256: hash(text), generatedAt: new Date().toISOString(), cases,
        distributions: {
            taskDomain: countBy(cases, (item) => [item.taskDomain]), modality: countBy(cases, (item) => [item.modality]), tier: countBy(cases, (item) => [item.tier]),
            supportStatus: countBy(cases, (item) => [item.supportStatus]), canvasType: countBy(cases, (item) => [item.canvasType]), source: countBy(cases, (item) => [item.source]),
            coverageTags: countBy(cases, (item) => item.coverageTags), riskFlags: countBy(cases, (item) => item.riskFlags), turnCount: countBy(cases, (item) => [String(item.turnCount)]),
        },
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildPilotCatalog().then((catalog) => process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`));
}

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { CaseTrace, GoldenCase } from "../types";
import { RUNNER_DIR, fileSha256 } from "./scoring-standard";
import type { CaseAssertionSidecar, LoadedCase } from "./types";

const CASES_DIR = path.join(RUNNER_DIR, "cases");
const ASSERTIONS_DIR = path.join(RUNNER_DIR, "scoring", "case-assertions");
const RUNS_DIR = path.join(RUNNER_DIR, "runs");

export function assessmentDir(runId: string, assessmentId: string) {
    return path.join(RUNNER_DIR, "assessments", runId, assessmentId);
}

export async function loadCase(runId: string, caseId: string, attempt = 1): Promise<LoadedCase> {
    const caseFile = path.join(CASES_DIR, `${caseId}.yaml`);
    const traceFile = path.join(RUNS_DIR, runId, "traces", `${caseId}-${attempt}.json`);
    const sidecarFile = path.join(ASSERTIONS_DIR, `${caseId}.yaml`);
    const [caseText, traceText, sidecarText] = await Promise.all([fs.readFile(caseFile, "utf8"), fs.readFile(traceFile, "utf8"), fs.readFile(sidecarFile, "utf8")]);
    return { caseDef: yaml.load(caseText) as GoldenCase, trace: JSON.parse(traceText) as CaseTrace, sidecar: yaml.load(sidecarText) as CaseAssertionSidecar, traceFile, caseFile, sidecarFile };
}

export async function listRunCases(runId: string) {
    const indexFile = path.join(RUNS_DIR, runId, "index.json");
    const index = JSON.parse(await fs.readFile(indexFile, "utf8")) as { cases?: Array<{ case_id: string; attempt: number }> };
    return index.cases || [];
}

export function relativeToRunner(file: string) {
    return path.relative(RUNNER_DIR, file).split(path.sep).join("/");
}

export async function assessmentHashes(loaded: LoadedCase) {
    return {
        trace: await fileSha256(loaded.traceFile),
        case: await fileSha256(loaded.caseFile),
        sidecar: await fileSha256(loaded.sidecarFile),
    };
}

export function pointerValue(value: unknown, pointer: string): unknown {
    if (!pointer || pointer === "/") return value;
    return pointer.split("/").slice(1).reduce<unknown>((current, token) => {
        if (current == null) return undefined;
        const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
        if (Array.isArray(current)) return current[Number(key)];
        if (typeof current === "object") return (current as Record<string, unknown>)[key];
        return undefined;
    }, value);
}

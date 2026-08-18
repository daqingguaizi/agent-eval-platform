import fs from "node:fs/promises";
import path from "node:path";
import { bootstrapBaseline } from "./bootstrap";
import { dimensionScores, evaluateAll } from "./assertions";
import { assessmentDir, assessmentHashes, listRunCases, loadCase, relativeToRunner } from "./loader";
import { buildScoreIndex, scoreIndexEntry, writeAssessmentFile, writeBaselineReport } from "./aggregate";
import { CONTRACT_FILE, fileSha256, loadStandard, RUNNER_DIR } from "./scoring-standard";
import type { CaseAssessment, LayerVerdict, ScoreIndexEntry } from "./types";

function getArg(name: string, fallback?: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function has(name: string) {
    return process.argv.includes(name);
}

function deterministicVerdict(assertions: CaseAssessment["deterministic"]["assertions"], dimensions: CaseAssessment["deterministic"]["diagnosticDimensions"]): LayerVerdict & { diagnosticScore: number } {
    const hardFail = assertions.some((item) => item.hardGate && item.status === "fail");
    const invalid = assertions.some((item) => item.status === "evidence_invalid");
    const pending = assertions.some((item) => item.status === "needs_human_review");
    const score = Math.round(0.35 * dimensions.result + 0.25 * dimensions.process + 0.25 * dimensions.safety + 0.15 * dimensions.output);
    const verdict = hardFail ? "fail" : invalid ? "evidence_invalid" : pending ? "needs_human_review" : score >= 80 ? "pass" : "fail";
    return { verdict, score, diagnosticScore: score, reason: hardFail ? "存在 Hard Gate 失败。" : invalid ? "评分证据无效。" : pending ? "存在需人工处理的断言。" : score >= 80 ? "规则评分通过，仍需人工认证。" : "规则诊断分低于阈值。", standardVersion: "1.0.0", standardSha256: "" };
}

async function main() {
    const runId = getArg("--run", "gs-full-1")!;
    const assessmentId = getArg("--assessment", "baseline-v1")!;
    if (has("--init")) {
        const bootstrap = await bootstrapBaseline(runId, assessmentId);
        console.log(`已冻结 ${bootstrap.manifest.cases.length} 条基线并生成 ${bootstrap.sidecars} 份 Sidecar：${bootstrap.assessmentDir}`);
        return;
    }
    await bootstrapBaseline(runId, assessmentId);
    const standard = await loadStandard();
    const dir = assessmentDir(runId, assessmentId);
    const cases = await listRunCases(runId);
    const indexEntries: ScoreIndexEntry[] = [];
    for (const entry of cases) {
        const loaded = await loadCase(runId, entry.case_id, entry.attempt);
        const assertions = await evaluateAll(loaded);
        const dimensions = dimensionScores(assertions);
        const verdict = deterministicVerdict(assertions, dimensions);
        verdict.standardVersion = standard.version;
        verdict.standardSha256 = standard.sha256;
        const hashes = await assessmentHashes(loaded);
        const assessmentFile = path.join(dir, "cases", `${loaded.caseDef.id}-${loaded.trace.attempt}.json`);
        const previous = await fs.readFile(assessmentFile, "utf8").then((text) => JSON.parse(text) as CaseAssessment).catch(() => null);
        const canReuseHuman = previous?.standard.sha256 === standard.sha256 && previous.traceRef.traceSha256 === hashes.trace;
        const hardGateFailure = assertions.some((item) => item.hardGate && item.status === "fail");
        const assessment: CaseAssessment = {
            schemaVersion: 1,
            assessmentId,
            traceRef: { runId, caseId: loaded.caseDef.id, attempt: loaded.trace.attempt, traceFile: relativeToRunner(loaded.traceFile), traceSha256: hashes.trace },
            caseRef: { caseFile: relativeToRunner(loaded.caseFile), caseSha256: hashes.case, sidecarFile: relativeToRunner(loaded.sidecarFile), sidecarSha256: hashes.sidecar },
            contractRef: { file: relativeToRunner(CONTRACT_FILE), sha256: await fileSha256(CONTRACT_FILE) },
            standard: { version: standard.version, sha256: standard.sha256 },
            provenance: "partial",
            createdAt: new Date().toISOString(),
            deterministic: { assertions, verdict, diagnosticDimensions: dimensions },
            judge: canReuseHuman && previous ? previous.judge : { status: "not_run", verdict: "needs_human_review", reason: "尚未执行 Judge；首轮需先由人工金标完成校准。", standardVersion: standard.version, standardSha256: standard.sha256, rubricIds: loaded.sidecar.rubricIds },
            human: canReuseHuman && previous ? previous.human : [],
            final: hardGateFailure ? { verdict: "fail", reason: "确定性评分发现Hard Gate失败；人工需复核证据但不能以平均分抵消。", standardVersion: standard.version, standardSha256: standard.sha256, adjudicated: false, diagnosticScore: verdict.diagnosticScore } : canReuseHuman && previous?.human.length ? { ...previous.final, diagnosticScore: verdict.diagnosticScore } : { verdict: "needs_human_review", reason: "首轮基线必须完成人工评分与必要裁决。", standardVersion: standard.version, standardSha256: standard.sha256, adjudicated: false, diagnosticScore: verdict.diagnosticScore },
        };
        await writeAssessmentFile(dir, assessment);
        indexEntries.push(scoreIndexEntry(assessment, loaded.caseDef));
    }
    const runIndex = JSON.parse(await fs.readFile(path.join(RUNNER_DIR, "runs", runId, "index.json"), "utf8")) as { meta?: Record<string, unknown> };
    const scoreIndex = buildScoreIndex(indexEntries, assessmentId, { version: standard.version, sha256: standard.sha256 }, runIndex.meta || {});
    await fs.writeFile(path.join(dir, "score-index.json"), JSON.stringify(scoreIndex, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(dir, "badcases.json"), JSON.stringify({ schemaVersion: 1, assessmentId, cases: indexEntries.filter((entry) => entry.hardGateFailures > 0).map((entry) => ({ caseId: entry.caseId, attempt: entry.attempt, status: "candidate", issueTypes: entry.issueTypes, regressionCandidate: entry.risk === "P0" })) }, null, 2) + "\n", "utf8");
    await writeBaselineReport(dir, scoreIndex);
    console.log(`评分完成：${indexEntries.length} 条，结果目录：${dir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

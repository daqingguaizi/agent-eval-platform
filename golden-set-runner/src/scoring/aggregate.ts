import fs from "node:fs/promises";
import path from "node:path";
import type { CaseAssessment, ScoreIndexEntry } from "./types";

export function percentile(values: number[], p: number) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

export function scoreIndexEntry(assessment: CaseAssessment, meta: { title: string; scenario: ScoreIndexEntry["scenario"]; risk: ScoreIndexEntry["risk"]; sampleType: ScoreIndexEntry["sampleType"]; canvasType: ScoreIndexEntry["canvasType"] }): ScoreIndexEntry {
    const hardGateFailures = assessment.deterministic.assertions.filter((item) => item.hardGate && item.status === "fail").length;
    const issueTypes = [...new Set(assessment.deterministic.assertions.flatMap((item) => item.issueType ? [item.issueType] : []).concat(assessment.judge.issueType ? [assessment.judge.issueType] : []).concat(assessment.human.flatMap((item) => item.issueTypes)))];
    const human = assessment.human.at(-1);
    return {
        caseId: assessment.traceRef.caseId,
        attempt: assessment.traceRef.attempt,
        title: meta.title,
        scenario: meta.scenario,
        risk: meta.risk,
        sampleType: meta.sampleType,
        canvasType: meta.canvasType,
        traceFile: assessment.traceRef.traceFile,
        deterministicVerdict: assessment.deterministic.verdict.verdict,
        judgeVerdict: assessment.judge.status === "complete" ? assessment.judge.verdict : assessment.judge.status,
        humanStatus: human?.status || "unassigned",
        finalVerdict: assessment.final.verdict,
        hardGateFailures,
        needsHumanReview: assessment.final.verdict === "needs_human_review" || assessment.deterministic.assertions.some((item) => item.status === "needs_human_review"),
        issueTypes,
        diagnosticScore: assessment.final.diagnosticScore,
    };
}

export function buildScoreIndex(entries: ScoreIndexEntry[], assessmentId: string, standard: { version: string; sha256: string }, runMeta: Record<string, unknown>) {
    const counts = {
        pass: entries.filter((entry) => entry.finalVerdict === "pass").length,
        fail: entries.filter((entry) => entry.finalVerdict === "fail").length,
        needs_human_review: entries.filter((entry) => entry.finalVerdict === "needs_human_review").length,
        not_applicable: entries.filter((entry) => entry.finalVerdict === "not_applicable").length,
        evidence_invalid: entries.filter((entry) => entry.finalVerdict === "evidence_invalid").length,
    };
    const effective = counts.pass + counts.fail;
    return {
        schemaVersion: 1,
        assessmentId,
        standard,
        runMeta,
        generatedAt: new Date().toISOString(),
        summary: {
            total: entries.length,
            effective,
            ...counts,
            qualityPassRate: effective ? counts.pass / effective : null,
            p0HardFails: entries.filter((entry) => entry.risk === "P0" && entry.hardGateFailures > 0).length,
            review: {
                unassigned: entries.filter((entry) => entry.humanStatus === "unassigned").length,
                draft: entries.filter((entry) => entry.humanStatus === "draft").length,
                submitted: entries.filter((entry) => entry.humanStatus === "submitted").length,
                secondReviewRequired: entries.filter((entry) => entry.humanStatus === "second_review_required").length,
                adjudicated: entries.filter((entry) => entry.humanStatus === "adjudicated").length,
            },
            stability: { available: false, reason: "gs-full-1 每条用例仅运行 N=1，不能计算 pass@k / pass^k。" },
        },
        cases: entries,
    };
}

export async function writeAssessmentFile(dir: string, assessment: CaseAssessment) {
    const file = path.join(dir, "cases", `${assessment.traceRef.caseId}-${assessment.traceRef.attempt}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(assessment, null, 2) + "\n", "utf8");
    return file;
}

export async function writeBaselineReport(dir: string, index: ReturnType<typeof buildScoreIndex>) {
    const summary = index.summary;
    const hardFailures = index.cases.filter((item) => item.hardGateFailures > 0);
    const lines = [
        "# Golden Set 认证基线报告",
        "",
        `- Assessment：\`${index.assessmentId}\``,
        `- 评分标准：\`${index.standard.version}\``,
        `- 生成时间：${index.generatedAt}`,
        "- 状态：**未认证**。首轮 50 条必须完成全量人工评分；P0 必须双评与必要裁决。",
        "- 运行次数：每条均为 N=1；本报告不包含稳定性、pass@k 或 pass^k 结论。",
        "",
        "## 运行与评分概览",
        "",
        `- Runner 执行完成：${(Number(index.runMeta.ok) || 0) + (Number(index.runMeta.fail) || 0)} / ${index.runMeta.totalCases || "?"}`,
        `- 质量通过：${summary.pass}；失败：${summary.fail}；待人工：${summary.needs_human_review}`,
        `- 有效 Case：${summary.effective}；P0 Hard Gate 候选：${summary.p0HardFails}`,
        `- 人工评分：已提交/已裁决 ${summary.review.submitted + summary.review.adjudicated} / ${summary.total}`,
        "- Token、工具次数、时延与成本仅按评分标准作为首轮观察项。",
        "",
        "## Hard Gate 候选",
        "",
        hardFailures.length ? hardFailures.map((item) => `- \`${item.caseId}\`（${item.risk}）：${item.issueTypes.join(", ") || "待人工确认"}`).join("\n") : "- 暂无",
        "",
        "## 后续动作",
        "",
        "1. 通过 Review 工作台完成全部 50 条人工评分；",
        "2. 对 P0、冲突、低置信和生成争议完成双评/裁决；",
        "3. 使用人工金标校准 Judge 后再运行 Judge 评分；",
        "4. 将确认 Badcase 归因、分配修复动作并纳入 Regression；",
        "5. 新增独立 Selection/Test 后，才可对候选改动做接受或发布判断。",
        "",
    ];
    await fs.writeFile(path.join(dir, "report.md"), lines.join("\n"), "utf8");
}

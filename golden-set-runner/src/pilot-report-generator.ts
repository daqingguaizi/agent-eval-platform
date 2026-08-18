import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPilotCatalog } from "./pilot-case-catalog";
import { listReviews } from "./pilot-review-store";
import { PILOT_SCORE_SCHEMA_VERSION, PILOT_SCORE_SPEC_VERSION, SCORE_DIMENSIONS, type PilotScoreSummary } from "./pilot-score-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const RUNS = path.join(ROOT, "runs");
export async function generatePilotReport(runId: string) {
    const catalog = await buildPilotCatalog(); const runDir = path.join(RUNS, runId); const missing: string[] = []; const current: Array<{ caseId: string; review: Awaited<ReturnType<typeof listReviews>>[number] }> = [];
    for (const item of catalog.cases) {
        const reviews = await listReviews(runId, item.id); const review = reviews.find((candidate) => candidate.isCurrent);
        if (!review) { missing.push(`${item.id}: 缺少当前有效人工评审`); continue; }
        current.push({ caseId: item.id, review });
    }
    const statusCounts = Object.fromEntries(current.reduce((map, item) => map.set(item.review.status, (map.get(item.review.status) || 0) + 1), new Map<string, number>()));
    const dimensionAverages = Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => { const scores = current.map((item) => item.review.scores[dimension]).filter((score): score is number => typeof score === "number"); return [dimension, scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : null]; }));
    const clusters = new Map<string, { caseIds: string[]; highestSeverity: string; recommendation: string }>(); const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    for (const { caseId, review } of current) for (const attribution of review.attributions) { const key = `${attribution.stage} / ${attribution.symptom} / ${attribution.responsibleArea}`; const cluster = clusters.get(key) || { caseIds: [], highestSeverity: attribution.severity, recommendation: attribution.recommendation }; cluster.caseIds.push(caseId); if (rank[attribution.severity] < rank[cluster.highestSeverity]) cluster.highestSeverity = attribution.severity; clusters.set(key, cluster); }
    const summary: PilotScoreSummary = { schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, runId, generatedAt: new Date().toISOString(), totalCases: catalog.cases.length, humanComplete: current.length, reportReady: missing.length === 0 && current.length === catalog.cases.length, missing, finalStatusCounts: statusCounts, dimensionAverages, clusters: [...clusters.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => a.highestSeverity.localeCompare(b.highestSeverity)) };
    await fs.mkdir(path.join(runDir, "scoring"), { recursive: true }); await fs.writeFile(path.join(runDir, "scoring", "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.reportReady) return summary;
    const markdown = `# 创作者试点评分与归因报告\n\n- Run：\`${runId}\`\n- Spec：\`${PILOT_SCORE_SPEC_VERSION}\`\n- 评审完成：${summary.humanComplete}/${summary.totalCases}\n\n## 最终状态\n\n${Object.entries(statusCounts).map(([status, count]) => `- ${status}: ${count}`).join("\n")}\n\n## 维度均分（0–5）\n\n${Object.entries(dimensionAverages).map(([dimension, score]) => `- ${dimension}: ${score ?? "N/A"}`).join("\n")}\n\n## 研发问题簇\n\n${summary.clusters.map((cluster) => `### ${cluster.key}\n\n- 严重度：${cluster.highestSeverity}\n- 受影响评审：${cluster.caseIds.length}\n- 建议：${cluster.recommendation}\n`).join("\n")}\n\n> 本报告以当前有效人工评审为最终质量依据；模型和确定性结果仅作可追溯辅助证据。\n`;
    await fs.writeFile(path.join(runDir, "scoring", "development-report.md"), markdown); return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const runId = process.argv[2]; if (!runId) throw new Error("用法：tsx src/pilot-report-generator.ts <runId>"); generatePilotReport(runId).then((summary) => console.log(summary.reportReady ? "研发报告已生成。" : `报告未就绪：${summary.missing.length} 项缺失。`)); }

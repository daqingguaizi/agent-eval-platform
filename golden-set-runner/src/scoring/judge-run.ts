import { runJudge } from "./judge";

function arg(name: string, fallback?: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const runId = arg("--run", "gs-full-1")!;
const assessmentId = arg("--assessment", "baseline-v1")!;
const caseId = arg("--case");

runJudge(runId, assessmentId, caseId).then(() => {
    console.log(`Judge 评分完成：${runId}/${assessmentId}${caseId ? `/${caseId}` : ""}`);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});

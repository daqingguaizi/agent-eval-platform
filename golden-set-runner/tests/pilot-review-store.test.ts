import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { appendReview, currentReview, listReviews, updateReview } from "../src/pilot-review-store";

const runId = "pilot_review_store_test";
const root = path.join(process.cwd(), "runs", runId);
const evidence = [{ path: "CP-01/result.json", label: "运行结果" }];

async function main() {
    await fs.mkdir(root, { recursive: true });
    try {
        const first = await appendReview(runId, "CP-01", { reviewerId: "reviewer-a", status: "pass", scores: { executionEvidence: 5 }, evidence, attributions: [], notes: "首次评审", recommendation: "无" });
        await fs.writeFile(path.join(root, "scoring", "invalidations.json"), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), cases: { "CP-01": { invalidatedAt: new Date().toISOString(), reason: "重跑", rerun: "rerun" } } }));
        assert.equal(await currentReview(runId, "CP-01"), null);
        const second = await appendReview(runId, "CP-01", { reviewerId: "reviewer-b", status: "partial", scores: { executionEvidence: 3 }, evidence, notes: "二次评审", recommendation: "修复后回归", attributions: [{ id: "attr-1", stage: "workspace_sync", symptom: "state_mismatch", responsibleArea: "workspace_sync", nature: "reliability", severity: "P1", confidence: 0.9, evidence, impact: "状态未持久化", recommendation: "补充同步保障", ownerModule: "workspace-sync" }] });
        const updated = await updateReview(runId, "CP-01", second.id, { reviewerId: "reviewer-b", status: "partial", scores: { executionEvidence: 4 }, evidence, notes: "更正后的二次评审", recommendation: "修复后回归", attributions: [{ id: "attr-2", stage: "workspace_sync", symptom: "state_mismatch", responsibleArea: "workspace_sync", nature: "reliability", severity: "P1", confidence: 0.9, evidence, impact: "状态未持久化", recommendation: "补充同步保障", ownerModule: "workspace-sync" }] });
        const records = await listReviews(runId, "CP-01");
        assert.equal(records.length, 2);
        assert.equal(records.find((item) => item.id === first.id)?.isCurrent, false);
        assert.equal(updated.id, second.id);
        assert.equal(updated.createdAt, second.createdAt);
        assert.equal((await currentReview(runId, "CP-01"))?.id, second.id);
        await fs.writeFile(path.join(root, "scoring", "development-report.md"), "已生成报告");
        await assert.rejects(() => updateReview(runId, "CP-01", second.id, { reviewerId: "reviewer-b", status: "partial", scores: { executionEvidence: 4 }, evidence, notes: "报告后尝试编辑", recommendation: "无", attributions: [{ id: "attr-3", stage: "workspace_sync", symptom: "state_mismatch", responsibleArea: "workspace_sync", nature: "reliability", severity: "P1", confidence: 0.9, evidence, impact: "状态未持久化", recommendation: "补充同步保障", ownerModule: "workspace-sync" }] }), /已冻结/);
        console.log("pilot-review-store.test: ok");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}
void main();

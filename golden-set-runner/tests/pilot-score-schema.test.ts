import assert from "node:assert/strict";
import { validateHumanReview, weightedScore } from "../src/pilot-score-schema";

const base = {
    reviewerId: "reviewer-test",
    status: "pass" as const,
    scores: { executionEvidence: 5, taskOrchestration: 4, canvasUsability: 4, artifactQuality: 5, reliabilityBoundary: 4 },
    evidence: [{ path: "CP-01/result.json", label: "运行结果" }],
    attributions: [],
    notes: "测试评审说明",
    recommendation: "保持现有行为",
};

validateHumanReview(base);
assert.equal(weightedScore(base.scores), 90);
assert.doesNotThrow(() => validateHumanReview({ ...base, status: "partial", attributions: [] }));
assert.throws(() => validateHumanReview({ ...base, scores: { artifactQuality: 6 } }), /无效/);
console.log("pilot-score-schema.test: ok");

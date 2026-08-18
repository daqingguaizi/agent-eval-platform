import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { scorePilotRun } from "../src/pilot-deterministic-scorer";

const runId = "pilot_deterministic_test";
const runDirectory = path.join(process.cwd(), "runs", runId);

async function main() {
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(path.join(runDirectory, "run.json"), JSON.stringify({ results: [] }));
    try {
        const output = await scorePilotRun(runId);
        assert.equal(output.cases.length, 30);
        const cp01 = output.cases.find((item) => item.caseId === "CP-01");
        assert.ok(cp01);
        assert.ok(cp01.rules.some((item) => item.id === "AGENT_TARGET_TURN_COMPLETED" && item.status === "needs_human_review"));
        assert.ok(!cp01.rules.some((item) => ["EVIDENCE_CANVAS_SNAPSHOT", "EVIDENCE_ARTIFACT_MANIFEST", "OUTPUT_MEDIA_PRESENT", "NETWORK_NO_CREDIT"].includes(item.id)));
        const cp26 = output.cases.find((item) => item.caseId === "CP-26");
        assert.ok(cp26?.rules.some((item) => item.id === "CONTENT_STORY_ISOLATION" && item.status === "needs_human_review"));
        console.log("pilot-deterministic-scorer.test: ok");
    } finally {
        await fs.rm(runDirectory, { recursive: true, force: true });
    }
}
void main();

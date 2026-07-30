import { executeNextQueuedRun } from "../src/execution/run-orchestrator";

const pollMs = Number(process.env.EVAL_WORKER_POLL_MS ?? 1000);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  while (!stopping) {
    try {
      const result = await executeNextQueuedRun();
      if (!result) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error("评测 Worker 执行失败", error);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

void main();

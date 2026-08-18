import fs from "node:fs";
import path from "node:path";

const progressDir = process.env.WORKRALLY_PROGRESS_DIR || path.resolve(import.meta.dirname, "..", "runs", "workrally-video-progress");
const taskId = process.env.WORKRALLY_TASK_ID || "";

function readProgress() {
    const files = fs.existsSync(progressDir) ? fs.readdirSync(progressDir).filter((file) => file.endsWith(".json")).sort() : [];
    const selected = taskId ? files.filter((file) => file === `${taskId}.json`) : files;
    if (!selected.length) {
        console.clear();
        console.log(`等待视频任务提交…\n目录：${progressDir}`);
        return;
    }
    const records = selected.map((file) => JSON.parse(fs.readFileSync(path.join(progressDir, file), "utf8")));
    console.clear();
    console.log(JSON.stringify(records, null, 2));
    if (records.every((record) => ["completed", "failed"].includes(record.phase))) process.exit(0);
}

readProgress();
setInterval(readProgress, 3_000);

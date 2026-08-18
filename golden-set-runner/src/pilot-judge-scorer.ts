import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPilotCatalog } from "./pilot-case-catalog";
import { scorePilotRun } from "./pilot-deterministic-scorer";
import { PILOT_SCORE_SCHEMA_VERSION, PILOT_SCORE_SPEC_VERSION, isScore, type DeterministicCaseScore, type JudgeResult, type JudgeTask } from "./pilot-score-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const RUNS = path.join(ROOT, "runs");
type Manifest = { media?: Array<{ archivePath?: string; mimeType?: string; status?: string }> };
const readJson = async <T>(file: string): Promise<T | null> => fs.readFile(file, "utf8").then((text) => JSON.parse(text) as T).catch(() => null);
const taskMarkdown = (task: JudgeTask) => `# DeepSeek V4 Pro 评分任务：${task.caseId}\n\n你是多模态创作产品评审助手。只基于给出的证据进行判断；无法确认时填 \`null\`，并写入 \`humanFocus\`。模型辅助结论不能替代人工结论。\n\n## 任务\n${task.instruction}\n\n## 确定性证据摘要\n\`\`\`json\n${JSON.stringify(task.deterministicSummary, null, 2)}\n\`\`\`\n\n## 媒体与证据路径\n${task.media.map((item) => `- ${item.role}/${item.mediaType}: ${item.path}${item.keyframes?.length ? `；关键帧：${item.keyframes.map((frame) => `${frame.timeMs}ms ${frame.path}`).join("；")}` : ""}`).join("\n") || "- 无可读媒体"}\n\n## 评分 Rubric\n${task.rubric.map((item) => `- **${item.dimension}**：${item.prompt}`).join("\n")}\n\n## 必须返回的 JSON\n\`\`\`json\n${JSON.stringify(task.responseContract, null, 2)}\n\`\`\`\n`;

export async function createJudgeTasks(runId: string) {
    const runDir = path.join(RUNS, runId); const deterministicFile = path.join(runDir, "scoring", "deterministic.json");
    const deterministic = await readJson<{ cases: DeterministicCaseScore[] }>(deterministicFile) || await scorePilotRun(runId);
    const catalog = await buildPilotCatalog(); const taskDir = path.join(runDir, "scoring", "judge-tasks"); await fs.mkdir(taskDir, { recursive: true });
    const tasks: JudgeTask[] = [];
    for (const caseDef of catalog.cases) {
        const score = deterministic.cases.find((item) => item.caseId === caseDef.id); if (!score) continue;
        const manifest = await readJson<Manifest>(path.join(runDir, caseDef.id, "evidence", "artifact-manifest.json"));
        const media = (manifest?.media || []).filter((item) => item.status === "archived" && item.archivePath).map((item) => ({ role: "output" as const, mediaType: (item.mimeType || "unknown").split("/")[0], path: `${caseDef.id}/${item.archivePath}`, keyframes: (item.mimeType || "").startsWith("video/") ? [{ timeMs: 0, path: `${caseDef.id}/${item.archivePath}#t=0` }, { timeMs: 0, path: `${caseDef.id}/${item.archivePath}#t=middle` }, { timeMs: 0, path: `${caseDef.id}/${item.archivePath}#t=end` }] : undefined }));
        const applicable = media.length > 0;
        const task: JudgeTask = {
            schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, taskId: crypto.createHash("sha256").update(`${runId}:${caseDef.id}:${PILOT_SCORE_SPEC_VERSION}`).digest("hex").slice(0, 16), caseId: caseDef.id, modelId: "deepseek-v4-pro", status: applicable ? "pending" : "not_applicable",
            instruction: caseDef.keyPoints.join("；") || caseDef.title, deterministicSummary: score,
            evidence: [{ path: `${caseDef.id}/result.json`, label: "运行结果" }, { path: `${caseDef.id}/evidence/canvas-snapshot.json`, label: "画布快照" }, { path: `${caseDef.id}/evidence/artifact-manifest.json`, label: "媒体清单" }], media,
            rubric: [
                { dimension: "artifactQuality", prompt: "检查主体、场景、风格、构图、动作/镜头、时长、参考素材保持、文字/禁用约束和可见瑕疵。5 分=关键要求均满足且可直接使用；4 分=仅轻微瑕疵；3 分=主结果可用但有明确缺口；2 分=关键约束或质量明显不足；1 分=核心任务大多未完成；0 分=无目标产物、关键事实矛盾或不可用。视频运动无法从证据确认时填 null，并说明需人工播放核验。" },
                { dimension: "taskOrchestration", prompt: "结合任务、画布快照、节点和连接，检查是否选对模态、完成关键步骤、避免无关或重复操作。5 分=所有关键节点和连接合理完成；4 分=核心完成且仅有轻微优化项；3 分=有结果但存在遗漏或不够合理步骤；2 分=仅部分关键步骤完成；1 分=核心步骤大多未做；0 分=错误模态或任务未执行。无法确认时填 null。" },
                { dimension: "canvasUsability", prompt: "检查画布是否保留可理解、可编辑的结构，节点状态是否一致，输出是否容易定位，是否残留错误/空闲节点。5 分=结构清楚且可继续编辑；4 分=轻微命名/布局问题；3 分=可编辑但有明显结构或状态问题；2 分=关键结构不完整；1 分=难以继续编辑；0 分=结构损坏或关键输出不可定位。无法确认时填 null。" },
                { dimension: "reliabilityBoundary", prompt: "核对产物、画布和最终反馈是否与确定性证据一致；失败、能力限制或缺输入时是否如实说明且不给出伪成功。5 分=事实一致且给出可恢复下一步；4 分=基本真实但信息不完整；3 分=真实但恢复建议较弱；2 分=存在明显遗漏；1 分=严重误导；0 分=将失败伪称成功。无法确认时填 null。" },
            ],
            responseContract: { caseId: caseDef.id, modelId: "deepseek-v4-pro", scores: { artifactQuality: "0-5 或 null", taskOrchestration: "0-5 或 null", canvasUsability: "0-5 或 null", reliabilityBoundary: "0-5 或 null" }, confidence: "0-1", findings: ["可见事实"], evidence: [{ path: "证据路径", note: "支持结论的证据" }], issueTags: ["quality_insufficient 等 Taxonomy 标签"], humanFocus: ["需要人工重点核验的项目"] },
        };
        tasks.push(task); await fs.writeFile(path.join(taskDir, `${caseDef.id}.json`), `${JSON.stringify(task, null, 2)}\n`); await fs.writeFile(path.join(taskDir, `${caseDef.id}.md`), taskMarkdown(task));
    }
    await fs.writeFile(path.join(runDir, "scoring", "judge-task-index.json"), `${JSON.stringify({ schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, modelId: "deepseek-v4-pro", generatedAt: new Date().toISOString(), tasks: tasks.map(({ taskId, caseId, status }) => ({ taskId, caseId, status })) }, null, 2)}\n`);
    return tasks;
}

export async function recordJudgeResults(runId: string, incoming: unknown) {
    const runDir = path.join(RUNS, runId); const index = await readJson<{ tasks?: Array<{ taskId: string; caseId: string }> }>(path.join(runDir, "scoring", "judge-task-index.json"));
    if (!index?.tasks) throw new Error("请先生成 DeepSeek V4 Pro 评分任务包");
    const raw = Array.isArray(incoming) ? incoming : (incoming as { results?: unknown[] })?.results;
    if (!Array.isArray(raw)) throw new Error("模型结果必须是 JSON 数组或 { results: [] }");
    const allowed = new Map(index.tasks.map((item) => [item.taskId, item.caseId]));
    const results: JudgeResult[] = raw.map((item) => {
        const value = item as Partial<JudgeResult>; const taskId = value.taskId;
        if (typeof taskId !== "string") throw new Error("模型结果缺少 taskId");
        const expectedCaseId = allowed.get(taskId);
        if (!expectedCaseId || value.caseId !== expectedCaseId || value.modelId !== "deepseek-v4-pro") throw new Error("模型结果的 taskId、caseId 或 modelId 不匹配");
        for (const score of Object.values(value.scores || {})) if (score !== null && !isScore(score)) throw new Error("模型维度分数必须为 0–5 或 null");
        if (typeof value.confidence === "number" && (value.confidence < 0 || value.confidence > 1)) throw new Error("模型置信度必须在 0–1");
        return { taskId, caseId: expectedCaseId, modelId: "deepseek-v4-pro", status: value.status === "not_applicable" ? "not_applicable" : value.status === "error" ? "error" : "complete", createdAt: new Date().toISOString(), scores: value.scores, confidence: value.confidence, evidence: value.evidence, findings: value.findings, humanFocus: value.humanFocus, raw: value.raw };
    });
    const file = path.join(runDir, "scoring", "judge-results.json"); const existing = await readJson<{ results?: JudgeResult[] }>(file); const merged = new Map((existing?.results || []).map((item) => [item.taskId, item]));
    for (const result of results) merged.set(result.taskId, result);
    const output = { schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, modelId: "deepseek-v4-pro", updatedAt: new Date().toISOString(), results: [...merged.values()] };
    await fs.writeFile(file, `${JSON.stringify(output, null, 2)}\n`); return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void (async () => {
        const [runId, mode, inputFile] = process.argv.slice(2); if (!runId) throw new Error("用法：tsx src/pilot-judge-scorer.ts <runId> [--record results.json]");
        if (mode === "--record") { if (!inputFile) throw new Error("缺少模型结果 JSON 文件"); const output = await recordJudgeResults(runId, JSON.parse(await fs.readFile(inputFile, "utf8"))); console.log(`已记录 ${output.results.length} 条 DeepSeek V4 Pro 评分结果。`); }
        else { const tasks = await createJudgeTasks(runId); console.log(`已生成 ${tasks.length} 个 DeepSeek V4 Pro 评分任务。`); }
    })();
}

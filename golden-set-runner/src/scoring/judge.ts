import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CaseTrace } from "../types";
import { assessmentDir, loadCase } from "./loader";
import { loadStandard, sha256 } from "./scoring-standard";
import type { CaseAssessment, EvidenceRef, JudgeAssessment, JudgeDimension } from "./types";

const JUDGE_SYSTEM = `你是 Canvas Agent 评测 Judge。你只能依据提供的脱敏证据与评分标准评分，不能补充不存在的事实。请严格输出 JSON，不要 Markdown。对每个维度按0-4统一锚点评分：4完整满足；3核心满足仅轻微瑕疵；2有实质遗漏但无关键事实或安全违反；1主要失败或误导；0与关键证据矛盾、虚构结果或违反真实性/安全。若证据不足、语义边界不清或无法可靠判断，needsHumanReview=true。`;

function reference(pointer: string, quote: string): EvidenceRef {
    return { file: "trace", pointer, excerpt: quote.slice(0, 600) };
}

function relevantSteps(trace: CaseTrace) {
    return trace.turns.flatMap((turn, turnIndex) => turn.steps.filter((step) => step.type === "tool_call" && ((step.rejections?.length || 0) > 0 || step.status === "error" || (step.generations?.length || 0) > 0)).map((step, stepIndex) => ({ turn: turn.index, step: step.step, pointer: `/turns/${turnIndex}/steps/${stepIndex}`, tool: step.tool, args: step.args, rejections: step.rejections, diff: step.diff, status: step.status, generations: step.generations })));
}

function buildEvidence(trace: CaseTrace, assessment: CaseAssessment, rubricIds: JudgeDimension[]) {
    const target = trace.turns.find((turn) => turn.index === trace.turns.find((item) => item.purpose === "target")?.index) || trace.turns.at(-1);
    return {
        caseId: trace.case_id,
        targetTurn: target?.index,
        userMessage: target?.userMessage || "",
        finalOutput: target?.output || "",
        finalState: { canvasType: (trace.finalState as { canvasType?: string })?.canvasType, nodes: ((trace.finalState as { nodes?: unknown[] })?.nodes || []).map((node) => ({ id: (node as { id?: string }).id, type: (node as { type?: string }).type, title: (node as { title?: string }).title })), connections: ((trace.finalState as { connections?: unknown[] })?.connections || []).length },
        relevantToolEvidence: relevantSteps(trace),
        deterministic: assessment.deterministic.assertions.map((item) => ({ ruleId: item.ruleId, status: item.status, hardGate: item.hardGate, reason: item.reason, issueType: item.issueType, evidenceRefs: item.evidenceRefs })),
        rubricIds,
    };
}

function extractJson(text: string) {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
    const source = (fenced || text).trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    return JSON.parse(start >= 0 && end >= start ? source.slice(start, end + 1) : source) as Record<string, unknown>;
}

function toJudgeAssessment(raw: Record<string, unknown>, rubricIds: JudgeDimension[], standard: { version: string; sha256: string }, details: { model: string; evidenceHash: string; latencyMs: number; promptHash: string }): JudgeAssessment {
    const dimensions = raw.dimensionScores && typeof raw.dimensionScores === "object" ? raw.dimensionScores as Record<string, unknown> : {};
    const scores: Partial<Record<JudgeDimension, number>> = {};
    for (const rubric of rubricIds) {
        const value = Number(dimensions[rubric]);
        if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error(`Judge 缺少或返回无效的 Rubric 分数：${rubric}`);
        scores[rubric] = value;
    }
    const confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Judge confidence 必须介于0和1之间");
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => reference(String(item.pointer || "/"), String(item.quote || ""))) : [];
    const score = Number(raw.score);
    return {
        status: "complete",
        verdict: raw.pass === true ? "pass" : raw.pass === false ? "fail" : "needs_human_review",
        score: Number.isFinite(score) ? score : Math.round(Object.values(scores).reduce((total, value) => total + (value || 0), 0) / rubricIds.length * 25),
        confidence,
        reason: String(raw.reason || ""),
        standardVersion: standard.version,
        standardSha256: standard.sha256,
        rubricIds,
        dimensionScores: scores,
        issueType: typeof raw.issueType === "string" ? raw.issueType : undefined,
        evidence,
        evidenceHash: details.evidenceHash,
        rubricHash: standard.sha256,
        model: details.model,
        promptHash: details.promptHash,
        latencyMs: details.latencyMs,
        raw,
        needsHumanReview: raw.needsHumanReview === true || confidence < 0.8,
    };
}

export async function runJudge(runId: string, assessmentId: string, caseId?: string) {
    const baseUrl = process.env.JUDGE_BASE_URL?.replace(/\/$/, "");
    const apiKey = process.env.JUDGE_API_KEY;
    const model = process.env.JUDGE_MODEL;
    if (!baseUrl || !apiKey || !model) throw new Error("Judge 需要 JUDGE_BASE_URL、JUDGE_API_KEY、JUDGE_MODEL 环境变量");
    const standard = await loadStandard();
    const dir = assessmentDir(runId, assessmentId);
    const files = (await fs.readdir(path.join(dir, "cases"))).filter((file) => file.endsWith(".json") && (!caseId || file.startsWith(`${caseId}-`))).sort();
    for (const file of files) {
        const assessmentFile = path.join(dir, "cases", file);
        const assessment = JSON.parse(await fs.readFile(assessmentFile, "utf8")) as CaseAssessment;
        const loaded = await loadCase(runId, assessment.traceRef.caseId, assessment.traceRef.attempt);
        const payload = buildEvidence(loaded.trace, assessment, loaded.sidecar.rubricIds);
        const evidenceHash = sha256(JSON.stringify(payload));
        const cacheFile = path.join(dir, "judge-cache", `${evidenceHash}-${sha256(model).slice(0, 12)}.json`);
        let judge: JudgeAssessment;
        try {
            const cached = await fs.readFile(cacheFile, "utf8").catch(() => "");
            if (cached) {
                judge = JSON.parse(cached) as JudgeAssessment;
                judge.cacheHit = true;
            } else {
                const started = Date.now();
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: JSON.stringify(payload) }] }),
                });
                if (!response.ok) throw new Error(`Judge HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
                const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
                const content = body.choices?.[0]?.message?.content;
                if (!content) throw new Error("Judge 未返回内容");
                judge = toJudgeAssessment(extractJson(content), loaded.sidecar.rubricIds, standard, { model, evidenceHash, latencyMs: Date.now() - started, promptHash: sha256(JUDGE_SYSTEM) });
                await fs.mkdir(path.dirname(cacheFile), { recursive: true });
                await fs.writeFile(cacheFile, JSON.stringify(judge, null, 2) + "\n", "utf8");
            }
        } catch (error) {
            judge = { status: "error", verdict: "needs_human_review", reason: "Judge 执行或解析失败，必须转人工。", error: error instanceof Error ? error.message : String(error), standardVersion: standard.version, standardSha256: standard.sha256, rubricIds: loaded.sidecar.rubricIds, needsHumanReview: true };
        }
        assessment.judge = judge;
        await fs.writeFile(assessmentFile, JSON.stringify(assessment, null, 2) + "\n", "utf8");
    }
}

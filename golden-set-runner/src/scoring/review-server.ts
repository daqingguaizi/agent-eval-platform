import crypto from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewEvidenceCatalog, resolveEvidenceCards } from "./review-evidence";
import { REVIEW_GUIDANCE } from "./review-guidance";
import type { CaseAssessment, HumanReview, JudgeDimension, ReviewSubmission } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = path.resolve(HERE, "..", "..");
const PORT = Number(process.env.REVIEW_PORT || 8765);
const MAX_BODY = 1_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const RUBRICS: JudgeDimension[] = ["RUBRIC_EVIDENCE_FAITHFULNESS", "RUBRIC_TASK_RESOLUTION", "RUBRIC_CLARITY_ACTIONABILITY", "RUBRIC_CREATIVE_ALIGNMENT"];

function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
}

function text(res: ServerResponse, status: number, value: string, type = "text/plain; charset=utf-8") {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(value);
}

function safeId(value: string | null, label: string) {
    if (!value || !SAFE_ID.test(value)) throw new Error(`无效${label}`);
    return value;
}

function assessmentRoot(runId: string, assessmentId: string) {
    return path.join(RUNNER_DIR, "assessments", runId, assessmentId);
}

function inside(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readBody(req: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > MAX_BODY) throw new Error("请求体过大");
        chunks.push(data);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function readJson<T>(file: string) {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function atomicJson(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(temporary, file);
}

function validateReview(input: unknown, assessment: CaseAssessment, submitted: boolean, resolvedEvidenceRefs?: HumanReview["evidenceRefs"]): HumanReview {
    if (!input || typeof input !== "object") throw new Error("评分数据无效");
    const data = input as ReviewSubmission;
    const evidenceRefs = resolvedEvidenceRefs || data.evidenceRefs || [];
    if (!data.reviewerId?.trim()) throw new Error("必须填写评审人");
    if (!data.role || !["reviewer_a", "reviewer_b", "adjudicator"].includes(data.role)) throw new Error("评审角色无效");
    if (!data.verdict || !["pass", "fail", "needs_human_review"].includes(data.verdict)) throw new Error("Case verdict 无效");
    if (data.standardVersion !== assessment.standard.version || data.standardSha256 !== assessment.standard.sha256) throw new Error("评分标准版本不匹配，当前记录仅允许只读查看");
    const scores = data.rubricScores || {};
    for (const [rubric, score] of Object.entries(scores)) {
        if (!RUBRICS.includes(rubric as JudgeDimension) || !Number.isInteger(score) || Number(score) < 0 || Number(score) > 4) throw new Error(`Rubric 分数无效：${rubric}`);
    }
    if (submitted && !Object.keys(scores).length) throw new Error("提交评分至少需要一个 Rubric 维度分数");
    if (submitted && !evidenceRefs.length) throw new Error("提交评分至少需要确认一张关键证据卡");
    for (const ref of evidenceRefs) {
        if (!ref.file || !ref.pointer) throw new Error("证据引用必须包含 file 与 pointer");
    }
    const now = new Date().toISOString();
    return {
        reviewId: data.reviewId || crypto.randomUUID(),
        reviewerId: data.reviewerId.trim(),
        role: data.role,
        status: submitted ? (data.role === "reviewer_b" ? "second_submitted" : data.role === "adjudicator" ? "adjudicated" : "submitted") : "draft",
        createdAt: data.createdAt || now,
        updatedAt: now,
        verdict: data.verdict,
        score: data.score,
        confidence: data.confidence,
        reason: data.reason || "",
        standardVersion: assessment.standard.version,
        standardSha256: assessment.standard.sha256,
        rubricScores: scores,
        hardGateConfirmed: Boolean(data.hardGateConfirmed),
        evidenceRefs,
        issueTypes: data.issueTypes || [],
        responsibleModules: data.responsibleModules || [],
        notes: data.notes || "",
        evidenceCompleteness: data.evidenceCompleteness || "partial",
        recommendations: data.recommendations || { badcase: false, regression: false, calibration: false },
        supersedes: data.supersedes,
    };
}

function reviewFile(root: string, caseId: string, reviewId: string) {
    return path.join(root, "reviews", caseId, `${reviewId}.json`);
}

async function isP0(root: string, caseId: string, attempt: number) {
    const index = await readJson<{ cases: Array<{ caseId: string; attempt: number; risk: string }> }>(path.join(root, "score-index.json"));
    return index.cases.some((item) => item.caseId === caseId && item.attempt === attempt && item.risk === "P0");
}

async function refreshScoreIndex(root: string, assessment: CaseAssessment, p0: boolean) {
    const file = path.join(root, "score-index.json");
    const index = await readJson<{ summary: Record<string, unknown>; cases: Array<Record<string, unknown>> }>(file);
    const item = index.cases.find((row) => row.caseId === assessment.traceRef.caseId && row.attempt === assessment.traceRef.attempt);
    if (!item) return;
    const submitted = assessment.human.filter((review) => ["submitted", "second_submitted", "adjudicated"].includes(review.status));
    const hasA = submitted.some((review) => review.role === "reviewer_a");
    const hasB = submitted.some((review) => review.role === "reviewer_b");
    item.humanStatus = assessment.final.adjudicated ? "adjudicated" : p0 && hasA && !hasB ? "second_review_required" : submitted.length ? "submitted" : assessment.human.at(-1)?.status || "unassigned";
    item.finalVerdict = assessment.final.verdict;
    item.needsHumanReview = assessment.final.verdict === "needs_human_review";
    item.diagnosticScore = assessment.final.diagnosticScore;
    const cases = index.cases;
    const count = (value: string) => cases.filter((row) => row.finalVerdict === value).length;
    const pass = count("pass");
    const fail = count("fail");
    index.summary = { ...index.summary, pass, fail, needs_human_review: count("needs_human_review"), not_applicable: count("not_applicable"), evidence_invalid: count("evidence_invalid"), effective: pass + fail, qualityPassRate: pass + fail ? pass / (pass + fail) : null, review: { unassigned: cases.filter((row) => row.humanStatus === "unassigned").length, draft: cases.filter((row) => row.humanStatus === "draft").length, submitted: cases.filter((row) => row.humanStatus === "submitted").length, secondReviewRequired: cases.filter((row) => row.humanStatus === "second_review_required").length, adjudicated: cases.filter((row) => row.humanStatus === "adjudicated").length } };
    await atomicJson(file, index);
}

async function refreshCaseAssessment(root: string, caseId: string, attempt: number) {
    const file = path.join(root, "cases", `${caseId}-${attempt}.json`);
    const assessment = await readJson<CaseAssessment>(file);
    const dir = path.join(root, "reviews", caseId);
    const reviews = await fs.readdir(dir).catch(() => [] as string[]);
    const parsed = await Promise.all(reviews.filter((name) => name.endsWith(".json")).map((name) => readJson<HumanReview>(path.join(dir, name))));
    assessment.human = parsed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const submitted = assessment.human.filter((review) => ["submitted", "second_submitted", "adjudicated"].includes(review.status));
    const adjudication = submitted.filter((review) => review.role === "adjudicator").at(-1);
    const p0 = await isP0(root, caseId, attempt);
    const reviewA = submitted.filter((review) => review.role === "reviewer_a").at(-1);
    const reviewB = submitted.filter((review) => review.role === "reviewer_b").at(-1);
    const primary = adjudication || reviewB || reviewA;
    if (adjudication) assessment.final = { ...adjudication, adjudicated: true, diagnosticScore: assessment.final.diagnosticScore };
    else if (p0 && reviewA && !reviewB) assessment.final = { verdict: "needs_human_review", reason: "P0 用例等待第二位独立评审。", standardVersion: assessment.standard.version, standardSha256: assessment.standard.sha256, adjudicated: false, diagnosticScore: assessment.final.diagnosticScore };
    else if (primary) assessment.final = { ...primary, adjudicated: p0 ? Boolean(reviewA && reviewB && reviewA.verdict === reviewB.verdict) : false, diagnosticScore: assessment.final.diagnosticScore };
    await atomicJson(file, assessment);
    await refreshScoreIndex(root, assessment, p0);
    return assessment;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const runId = safeId(url.searchParams.get("run") || "gs-full-1", "runId");
    const assessmentId = safeId(url.searchParams.get("assessment") || "baseline-v1", "assessmentId");
    const root = assessmentRoot(runId, assessmentId);
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, mode: "review", root: path.relative(RUNNER_DIR, root), port: PORT });
    if (url.pathname === "/api/assessment" && req.method === "GET") return json(res, 200, await readJson(path.join(root, "score-index.json")));
    if (url.pathname === "/api/review-guidance" && req.method === "GET") return json(res, 200, REVIEW_GUIDANCE);
    const caseId = url.searchParams.get("case");
    const attempt = Number(url.searchParams.get("attempt") || 1);
    if (url.pathname === "/api/case" && req.method === "GET") {
        const id = safeId(caseId, "caseId");
        const assessment = await readJson<CaseAssessment>(path.join(root, "cases", `${id}-${attempt}.json`));
        const trace = await readJson(path.join(RUNNER_DIR, assessment.traceRef.traceFile));
        return json(res, 200, { assessment, trace });
    }
    if (url.pathname === "/api/review-evidence" && req.method === "GET") {
        const id = safeId(caseId, "caseId");
        const assessment = await readJson<CaseAssessment>(path.join(root, "cases", `${id}-${attempt}.json`));
        const trace = await readJson(path.join(RUNNER_DIR, assessment.traceRef.traceFile));
        return json(res, 200, buildReviewEvidenceCatalog(assessment, trace));
    }
    if (url.pathname === "/api/reviews" && req.method === "GET") {
        const id = safeId(caseId, "caseId");
        const dir = path.join(root, "reviews", id);
        const files = await fs.readdir(dir).catch(() => [] as string[]);
        return json(res, 200, await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name)))));
    }
    if (url.pathname === "/api/reviews/export" && req.method === "GET") {
        const id = safeId(caseId, "caseId");
        const assessment = await readJson<CaseAssessment>(path.join(root, "cases", `${id}-${attempt}.json`));
        const dir = path.join(root, "reviews", id);
        const files = await fs.readdir(dir).catch(() => [] as string[]);
        const reviews = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(dir, name))));
        return json(res, 200, { schemaVersion: 1, exportedAt: new Date().toISOString(), runId, assessmentId, caseId: id, attempt, traceSha256: assessment.traceRef.traceSha256, standard: assessment.standard, reviews });
    }
    if (url.pathname === "/api/reviews/import" && req.method === "POST") {
        const id = safeId(caseId, "caseId");
        const body = await readBody(req) as { traceSha256?: string; standard?: { version?: string; sha256?: string }; reviews?: unknown[] };
        const assessment = await readJson<CaseAssessment>(path.join(root, "cases", `${id}-${attempt}.json`));
        if (body.traceSha256 !== assessment.traceRef.traceSha256 || body.standard?.sha256 !== assessment.standard.sha256) throw new Error("评分包的Trace或评分标准版本不匹配");
        if (!Array.isArray(body.reviews)) throw new Error("评分包缺少reviews数组");
        for (const item of body.reviews) {
            const review = validateReview(item, assessment, (item as { status?: string }).status !== "draft");
            const target = reviewFile(root, id, review.reviewId);
            if (await fs.access(target).then(() => true).catch(() => false)) throw new Error(`评分记录已存在：${review.reviewId}`);
            await atomicJson(target, review);
        }
        return json(res, 200, { assessment: await refreshCaseAssessment(root, id, attempt) });
    }
    if (["/api/reviews/draft", "/api/reviews/submit", "/api/reviews/adjudicate"].includes(url.pathname) && req.method === "POST") {
        const id = safeId(caseId, "caseId");
        const body = await readBody(req);
        const assessmentFile = path.join(root, "cases", `${id}-${attempt}.json`);
        const assessment = await readJson<CaseAssessment>(assessmentFile);
        const submitted = url.pathname !== "/api/reviews/draft";
        const submission = body as ReviewSubmission;
        const trace = await readJson(path.join(RUNNER_DIR, assessment.traceRef.traceFile));
        const selectedCardIds = submission.evidenceCardIds;
        const resolvedEvidenceRefs = Array.isArray(selectedCardIds)
            ? selectedCardIds.length ? resolveEvidenceCards(selectedCardIds, buildReviewEvidenceCatalog(assessment, trace)) : []
            : undefined;
        const review = validateReview(body, assessment, submitted, resolvedEvidenceRefs);
        if (url.pathname === "/api/reviews/adjudicate" && review.role !== "adjudicator") throw new Error("裁决只能由 adjudicator 角色提交");
        if (url.pathname === "/api/reviews/submit" && review.role === "adjudicator") throw new Error("裁决请使用 adjudicate 接口");
        await atomicJson(reviewFile(root, id, review.reviewId), review);
        const updated = await refreshCaseAssessment(root, id, attempt);
        return json(res, 200, { review, assessment: updated });
    }
    return json(res, 404, { error: "API 不存在" });
}

async function serveStatic(res: ServerResponse, requestPath: string) {
    const decoded = decodeURIComponent(requestPath === "/" ? "/viewer/index.html" : requestPath);
    const file = path.resolve(RUNNER_DIR, `.${decoded}`);
    if (!inside(RUNNER_DIR, file) && file !== path.join(RUNNER_DIR, "viewer", "index.html")) return text(res, 403, "Forbidden");
    try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) return text(res, 404, "Not found");
        const ext = path.extname(file).toLowerCase();
        const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
        res.writeHead(200, { "content-type": types[ext] || "application/octet-stream", "cache-control": "no-store" });
        res.end(await fs.readFile(file));
    } catch {
        text(res, 404, "Not found");
    }
}

http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    Promise.resolve(url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(res, url.pathname)).catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }));
}).listen(PORT, "127.0.0.1", () => {
    console.log(`Review 工作台已启动：http://127.0.0.1:${PORT}/viewer/index.html`);
});

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_SCORE_SCHEMA_VERSION, PILOT_SCORE_SPEC_VERSION, type HumanReview, validateHumanReview } from "./pilot-score-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = path.join(ROOT, "runs");
const safeId = (value: string, label: string) => { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} 格式无效`); return value; };
const readJson = async <T>(file: string, fallback: T) => fs.readFile(file, "utf8").then((text) => JSON.parse(text) as T).catch(() => fallback);
export const scoringDirectory = (runId: string) => path.join(RUNS, safeId(runId, "Run ID"), "scoring");
export const reviewDirectory = (runId: string) => path.join(scoringDirectory(runId), "reviews");
const invalidationFile = (runId: string) => path.join(scoringDirectory(runId), "invalidations.json");
const reportFile = (runId: string) => path.join(scoringDirectory(runId), "development-report.md");
type Invalidations = { schemaVersion: number; updatedAt: string; cases: Record<string, { invalidatedAt: string; reason: string; rerun?: string }> };
const readInvalidations = (runId: string) => readJson<Invalidations>(invalidationFile(runId), { schemaVersion: PILOT_SCORE_SCHEMA_VERSION, updatedAt: "", cases: {} });

export async function listReviews(runId: string, caseId: string): Promise<HumanReview[]> {
    const directory = path.join(reviewDirectory(runId), safeId(caseId, "Case ID"));
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    const reviews = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => readJson<HumanReview | null>(path.join(directory, entry), null)));
    return reviews.filter((review): review is HumanReview => Boolean(review)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function appendReview(runId: string, caseId: string, submission: Omit<HumanReview, "id" | "createdAt" | "isCurrent"> & { isCurrent?: boolean }) {
    safeId(caseId, "Case ID"); validateHumanReview(submission);
    if (await fs.access(reportFile(runId)).then(() => true).catch(() => false)) throw new Error("最终研发报告已生成，本轮人工评审已冻结；请开启新的评分轮次后再编辑。");
    const directory = path.join(reviewDirectory(runId), caseId); await fs.mkdir(directory, { recursive: true });
    const existing = await listReviews(runId, caseId);
    const now = new Date().toISOString();
    const review: HumanReview = { ...submission, id: crypto.randomUUID(), createdAt: now, isCurrent: submission.isCurrent !== false };
    if (review.isCurrent) {
        await Promise.all(existing.filter((item) => item.isCurrent).map(async (item) => {
            const file = path.join(directory, `${item.id}.json`); await fs.writeFile(file, `${JSON.stringify({ ...item, isCurrent: false }, null, 2)}\n`);
        }));
    }
    await fs.writeFile(path.join(directory, `${review.id}.json`), `${JSON.stringify(review, null, 2)}\n`, { flag: "wx" });
    if (review.isCurrent) {
        const invalidations = await readInvalidations(runId);
        if (invalidations.cases[caseId]) { delete invalidations.cases[caseId]; invalidations.updatedAt = now; await fs.writeFile(invalidationFile(runId), `${JSON.stringify(invalidations, null, 2)}\n`); }
    }
    await refreshReviewIndex(runId); return review;
}

export async function updateReview(runId: string, caseId: string, reviewId: string, submission: Omit<HumanReview, "id" | "createdAt" | "isCurrent">) {
    safeId(caseId, "Case ID"); safeId(reviewId, "评审 ID"); validateHumanReview(submission);
    if (await fs.access(reportFile(runId)).then(() => true).catch(() => false)) throw new Error("最终研发报告已生成，本轮人工评审已冻结；请开启新的评分轮次后再编辑。");
    const directory = path.join(reviewDirectory(runId), caseId); const existing = await listReviews(runId, caseId);
    const original = existing.find((review) => review.id === reviewId);
    if (!original) throw new Error("待编辑的人工评审不存在");
    const review: HumanReview = { ...submission, id: original.id, createdAt: original.createdAt, isCurrent: original.isCurrent };
    await fs.writeFile(path.join(directory, `${reviewId}.json`), `${JSON.stringify(review, null, 2)}\n`);
    await refreshReviewIndex(runId); return review;
}

export async function currentReview(runId: string, caseId: string) {
    if ((await readInvalidations(runId)).cases[caseId]) return null;
    return (await listReviews(runId, caseId)).find((item) => item.isCurrent) || null;
}
export async function refreshReviewIndex(runId: string) {
    const directory = reviewDirectory(runId); const ids = await fs.readdir(directory).catch(() => [] as string[]); const invalidations = await readInvalidations(runId);
    const cases = await Promise.all(ids.filter((id) => /^CP-\d{2}$/.test(id)).map(async (caseId) => ({ caseId, reviews: await listReviews(runId, caseId), invalidated: invalidations.cases[caseId] })));
    const index = { schemaVersion: PILOT_SCORE_SCHEMA_VERSION, specVersion: PILOT_SCORE_SPEC_VERSION, updatedAt: new Date().toISOString(), cases: cases.map(({ caseId, reviews, invalidated }) => ({ caseId, count: reviews.length, currentReviewId: invalidated ? null : reviews.find((item) => item.isCurrent)?.id || null, status: invalidated ? "pending_human_review" : reviews.find((item) => item.isCurrent)?.status || "pending_human_review", needsConfirmation: Boolean(invalidated) || reviews.some((item) => item.isCurrent && item.needsConfirmation), invalidated: Boolean(invalidated) })) };
    await fs.mkdir(scoringDirectory(runId), { recursive: true }); await fs.writeFile(path.join(scoringDirectory(runId), "review-index.json"), `${JSON.stringify(index, null, 2)}\n`); return index;
}

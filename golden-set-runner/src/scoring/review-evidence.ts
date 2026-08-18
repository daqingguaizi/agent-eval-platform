import crypto from "node:crypto";
import type { CaseAssessment, EvidenceRef, ReviewEvidenceCard, ReviewEvidenceCatalog } from "./types";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const asArray = (value: unknown) => Array.isArray(value) ? value : [];
const refKey = (ref: EvidenceRef) => `${ref.file}#${ref.pointer}`;
const cardId = (ref: EvidenceRef) => `ev_${crypto.createHash("sha256").update(refKey(ref)).digest("hex").slice(0, 16)}`;

function titleForPointer(pointer: string, trace: JsonRecord) {
    if (pointer === "/finalState") return "最终画布状态";
    if (pointer.endsWith("/userMessage")) return "用户任务";
    if (pointer.endsWith("/output")) return "最终回复";
    if (pointer.includes("/rejections/")) return "执行层拒绝";
    if (pointer.endsWith("/diff")) return "画布状态变化";
    const match = pointer.match(/^\/turns\/(\d+)\/steps\/(\d+)/);
    if (!match) return "Trace 证据";
    const turn = asRecord(asArray(trace.turns)[Number(match[1])]);
    const step = asRecord(asArray(turn.steps)[Number(match[2])]);
    return typeof step.tool === "string" ? `工具操作 · ${step.tool}` : "模型消息";
}

function categoryForPointer(pointer: string) {
    if (pointer === "/finalState" || pointer.endsWith("/diff")) return "状态变化";
    if (pointer.endsWith("/output")) return "最终回复";
    if (pointer.includes("/rejections/")) return "执行层拒绝";
    if (pointer.endsWith("/userMessage")) return "用户任务";
    return "关键操作";
}

function addCard(cards: Map<string, ReviewEvidenceCard>, ref: EvidenceRef, trace: JsonRecord, options: { detail?: string; recommended?: boolean } = {}) {
    if (!ref.file || !ref.pointer) return;
    const id = cardId(ref);
    const current = cards.get(id);
    if (current) {
        current.recommended ||= Boolean(options.recommended);
        if (options.detail && !current.detail.includes(options.detail)) current.detail = `${current.detail}；${options.detail}`;
        return;
    }
    cards.set(id, {
        id,
        title: titleForPointer(ref.pointer, trace),
        category: categoryForPointer(ref.pointer),
        detail: options.detail || "可展开查看原始 Trace。",
        ref,
        recommended: Boolean(options.recommended),
    });
}

export function buildReviewEvidenceCatalog(assessment: CaseAssessment, trace: unknown): ReviewEvidenceCatalog {
    const traceRecord = asRecord(trace);
    const cards = new Map<string, ReviewEvidenceCard>();
    const traceFile = assessment.traceRef.traceFile;
    const assertions = assessment.deterministic.assertions || [];
    const hardOrFail = assertions.filter((item) => item.hardGate || item.status === "fail");

    for (const assertion of assertions) {
        for (const ref of assertion.evidenceRefs || []) addCard(cards, ref, traceRecord, {
            detail: `${assertion.ruleId}：${assertion.reason}`,
            recommended: hardOrFail.includes(assertion),
        });
    }
    for (const ref of assessment.judge.evidence || []) addCard(cards, ref, traceRecord, { detail: "Judge 使用的评分依据。", recommended: assessment.judge.status === "complete" });

    for (const [turnIndex, turnValue] of asArray(traceRecord.turns).entries()) {
        const turn = asRecord(turnValue);
        if (typeof turn.userMessage === "string") addCard(cards, { file: traceFile, pointer: `/turns/${turnIndex}/userMessage` }, traceRecord, { detail: "被测轮的用户任务。" });
        for (const [stepIndex, stepValue] of asArray(turn.steps).entries()) {
            const step = asRecord(stepValue);
            const stepPointer = `/turns/${turnIndex}/steps/${stepIndex}`;
            const hasStateEvidence = step.diff || asArray(step.rejections).length || asArray(step.ops).length || step.status === "error";
            if (hasStateEvidence) addCard(cards, { file: traceFile, pointer: stepPointer }, traceRecord, { detail: "关键工具操作及其执行结果。", recommended: !hardOrFail.length && Boolean(step.ops || step.diff) });
            if (step.diff) addCard(cards, { file: traceFile, pointer: `${stepPointer}/diff` }, traceRecord, { detail: "该操作造成的画布状态变化。", recommended: !hardOrFail.length });
            for (const [rejectionIndex] of asArray(step.rejections).entries()) addCard(cards, { file: traceFile, pointer: `${stepPointer}/rejections/${rejectionIndex}` }, traceRecord, { detail: "执行层明确拒绝的操作与原因。", recommended: true });
        }
        if (typeof turn.output === "string") addCard(cards, { file: traceFile, pointer: `/turns/${turnIndex}/output` }, traceRecord, { detail: "Agent 面向用户的最终说明。", recommended: true });
    }
    if (traceRecord.finalState) addCard(cards, { file: traceFile, pointer: "/finalState" }, traceRecord, { detail: "全部轮次结束后的最终画布状态。", recommended: !hardOrFail.length });

    const list = [...cards.values()];
    const selectedByDefault = list.filter((card) => card.recommended).map((card) => card.id);
    return { cards: list, selectedByDefault: selectedByDefault.length ? selectedByDefault : list.slice(0, 1).map((card) => card.id) };
}

export function resolveEvidenceCards(ids: unknown, catalog: ReviewEvidenceCatalog) {
    if (!Array.isArray(ids) || !ids.length) throw new Error("请至少确认一张关键证据卡");
    const available = new Map(catalog.cards.map((card) => [card.id, card]));
    const selected = [...new Set(ids.map(String))].map((id) => available.get(id));
    if (selected.some((card) => !card)) throw new Error("所选证据卡已失效，请刷新当前 Case 后重试");
    return selected.map((card) => card!.ref);
}

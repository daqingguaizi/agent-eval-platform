import { createRequire } from "node:module";
import path from "node:path";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./target-types";

const require = createRequire(import.meta.url);

function targetWebRoot() {
    const root = process.env.ECHO_TARGET_WEB_ROOT;
    if (!root) throw new Error("缺少 ECHO_TARGET_WEB_ROOT：请指向被测画布产品的 web 目录。");
    return path.resolve(root);
}

function targetModule(relativePath: string) {
    return path.join(targetWebRoot(), relativePath);
}

type CanvasOpsModule = {
    applyCanvasAgentOps: (snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[]) => CanvasAgentSnapshot & { rejections?: unknown[] };
};

type WorkRallyModule = {
    listWorkrallyModels: () => Promise<{ models: unknown }>;
    generateWorkrallyImages: (input: { prompt: string; model: string; count: number }) => Promise<Array<{ dataUrl?: string }>>;
    generateWorkrallyVideo: (input: { prompt: string; model: string }) => Promise<{ dataUrl?: string }>;
};

function canvasOpsModule() {
    return require(targetModule("src/app/(user)/canvas/utils/canvas-agent-ops.ts")) as CanvasOpsModule;
}

function workRallyModule() {
    return require(targetModule("src/lib/server/workrally-cli.ts")) as WorkRallyModule;
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[]) {
    return canvasOpsModule().applyCanvasAgentOps(snapshot, ops);
}

export function listWorkrallyModels() {
    return workRallyModule().listWorkrallyModels();
}

export function generateWorkrallyImages(input: { prompt: string; model: string; count: number }) {
    return workRallyModule().generateWorkrallyImages(input);
}

export function generateWorkrallyVideo(input: { prompt: string; model: string }) {
    return workRallyModule().generateWorkrallyVideo(input);
}

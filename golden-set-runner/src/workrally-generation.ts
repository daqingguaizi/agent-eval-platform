// WorkRally 真实生成：复用 web 端 web/src/lib/server/workrally-cli.ts（纯 Node，无 Next 依赖）
import fs from "node:fs/promises";
import path from "node:path";
import { listWorkrallyModels, generateWorkrallyImages, generateWorkrallyVideo } from "./target-adapter";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./target-types";

export type WorkRallyContext = {
    artifactsDir: string;   // 绝对路径，产物落盘目录
};

let modelCache: { image: string[]; video: string[] } | null = null;

// 探测可用模型（先调 CLI 拿模型 id 列表，避免硬编码）。失败返回空并留待调用方降级。
export async function discoverModels(): Promise<{ image: string[]; video: string[] }> {
    if (modelCache) return modelCache;
    try {
        const result = await listWorkrallyModels();
        const image = (result.models as string[]).filter((m) => m.startsWith("workrally-image:"));
        const video = (result.models as string[]).filter((m) => m.startsWith("workrally-video:"));
        modelCache = { image, video };
        return modelCache;
    } catch (error) {
        modelCache = { image: [], video: [] };
        return modelCache;
    }
}

async function decodeAndSave(dataUrl: string, artifactsDir: string, name: string, extHint: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    const mime = match ? match[1] : `image/${extHint}`;
    const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("mp4") ? "mp4" : mime.includes("webm") ? "webm" : extHint;
    const file = path.join(artifactsDir, `${name}.${ext}`);
    if (match) {
        await fs.writeFile(file, Buffer.from(match[2], "base64"));
    } else {
        // 非 data URL（可能是 http url），无法本地解码，记录原 url
        return { file, externalUrl: dataUrl };
    }
    return { file, externalUrl: undefined };
}

// 执行一次生成：op.mode 决定生图/生视频。返回产物相对路径（artifacts/<name>.<ext>）。
export async function generateWithWorkRally(op: Extract<CanvasAgentOp, { type: "run_generation" }>, snapshot: CanvasAgentSnapshot, ctx: WorkRallyContext): Promise<{ artifact: string }> {
    const mode = op.mode || "image";
    const target = snapshot.nodes.find((node) => node.id === op.nodeId);
    const prompt = op.prompt?.trim() ? op.prompt : ((target?.metadata as Record<string, unknown>)?.composerContent ?? (target?.metadata as Record<string, unknown>)?.prompt ?? "") as string;
    if (!prompt) throw new Error("生成提示词为空，无法调用 WorkRally");

    const models = await discoverModels();
    const ts = Date.now();

    if (mode === "video") {
        const model = models.video[0];
        if (!model) throw new Error("未探测到可用的 WorkRally 视频模型");
        const result = await generateWorkrallyVideo({ prompt, model });
        const dataUrl = result.dataUrl || "";
        const name = `video-${op.nodeId}-${ts}`;
        const { file, externalUrl } = await decodeAndSave(dataUrl, ctx.artifactsDir, name, "mp4");
        const relative = externalUrl ? externalUrl : path.relative(path.dirname(ctx.artifactsDir), file);
        return { artifact: relative };
    }

    if (mode === "audio") {
        throw new Error("未配置可由无头Runner调用的真实音频Provider；音频Case不会降级为图片生成。");
    }

    const model = models.image[0];
    if (!model) throw new Error("未探测到可用的 WorkRally 图片模型");
    const result = await generateWorkrallyImages({ prompt, model, count: 1 });
    const dataUrl = result[0]?.dataUrl || "";
    const name = `image-${op.nodeId}-${ts}`;
    const { file, externalUrl } = await decodeAndSave(dataUrl, ctx.artifactsDir, name, "png");
    const relative = externalUrl ? externalUrl : path.relative(path.dirname(ctx.artifactsDir), file);
    return { artifact: relative };
}

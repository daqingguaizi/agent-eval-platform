import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CanvasAgentOp } from "./target-types";
import { uploadVideoMedia } from "./media-upload-client";
import type { PilotCase, PilotMediaRef, MediaArtifact } from "./types";

export type TurnAttachment = { name: string; type: string; dataUrl: string };
export type FixturePreparation = {
    inputMedia: MediaArtifact[];
    setupOps: CanvasAgentOp[];
    attachmentsByTurn: Map<number, TurnAttachment[]>;
};

function mimeFor(fileName: string, mediaType: PilotMediaRef["mediaType"]) {
    const ext = path.extname(fileName).toLowerCase();
    if (mediaType === "video") return ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";
    if (mediaType === "audio") return ext === ".wav" ? "audio/wav" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
}

async function readVerified(resource: PilotMediaRef) {
    if (!resource.sourceDirectory) throw new Error(`资源 ${resource.fileName} 缺少 sourceDirectory`);
    const file = path.resolve(resource.sourceDirectory, resource.fileName);
    const content = await fs.readFile(file);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    if (resource.sha256 && resource.sha256 !== sha256) throw new Error(`资源哈希不匹配：${resource.fileName}`);
    return { file, content, sha256 };
}

function safeResourceSource(resource: PilotMediaRef) {
    return `pilot-resource://${encodeURIComponent(resource.fileName)}`;
}

const uploadedVideoCache = new Map<string, Awaited<ReturnType<typeof uploadVideoMedia>>>();

async function uploadVerifiedVideo(resource: PilotMediaRef) {
    const { content, sha256 } = await readVerified(resource);
    const cached = uploadedVideoCache.get(sha256);
    if (cached) return { uploaded: cached, sha256 };
    const uploaded = await uploadVideoMedia(resource.fileName, content, mimeFor(resource.fileName, resource.mediaType));
    uploadedVideoCache.set(sha256, uploaded);
    return { uploaded, sha256 };
}

export async function buildComposerAttachments(resources: PilotMediaRef[]): Promise<TurnAttachment[]> {
    const attachments: TurnAttachment[] = [];
    for (const resource of resources) {
        if (resource.mediaType !== "image") continue;
        const { content } = await readVerified(resource);
        const type = mimeFor(resource.fileName, resource.mediaType);
        attachments.push({ name: resource.fileName, type, dataUrl: `data:${type};base64,${content.toString("base64")}` });
    }
    return attachments;
}

export async function preparePilotMedia(caseDef: PilotCase): Promise<FixturePreparation> {
    const inputMedia: MediaArtifact[] = [];
    const setupOps: CanvasAgentOp[] = [];
    const attachmentsByTurn = new Map<number, TurnAttachment[]>();
    const resources = new Map(caseDef.pilot.resourceRefs.map((resource) => [resource.fileName, resource]));

    for (const resource of caseDef.pilot.resourceRefs) {
        const { content, sha256 } = await readVerified(resource);
        inputMedia.push({
            role: "input",
            mediaType: resource.mediaType,
            title: resource.fileName,
            source: safeResourceSource(resource),
            previewSource: safeResourceSource(resource),
            sourceKind: "controlled-input",
            mimeType: mimeFor(resource.fileName, resource.mediaType),
            sha256,
            bytes: content.byteLength,
            status: "ready",
        });
    }

    for (const turn of caseDef.pilot.turns) {
        const turnAttachments: TurnAttachment[] = [];
        for (const attachment of turn.attachments) {
            const resource = resources.get(attachment.fileName) || attachment;
            if (resource.mediaType !== "image") continue;
            turnAttachments.push(...await buildComposerAttachments([resource]));
        }
        if (turnAttachments.length) attachmentsByTurn.set(turn.index, turnAttachments);
    }

    // 图片严格沿 Composer attachments 协议传递；不在无头端伪造 image 节点。
    // 视频没有 Composer 附件协议，必须先经产品公开上传接口取得真实 storageKey/url，
    // 再按产品 videoMetadata 语义创建节点；上传不可用时直接失败，不写占位节点。
    let videoIndex = 0;
    for (const resource of caseDef.pilot.resourceRefs.filter((item) => item.mediaType === "video")) {
        const entry = inputMedia.find((item) => item.title === resource.fileName)!;
        const { uploaded, sha256 } = await uploadVerifiedVideo(resource);
        const nodeId = `fixture-video-${caseDef.id}-${++videoIndex}`;
        entry.nodeId = nodeId;
        entry.source = uploaded.url;
        entry.previewSource = safeResourceSource(resource);
        entry.sourceKind = "uploaded-media";
        entry.mimeType = uploaded.mimeType;
        entry.bytes = uploaded.bytes;
        entry.sha256 = sha256;
        entry.status = "external";
        setupOps.push({
            type: "add_node",
            id: nodeId,
            nodeType: "video",
            title: resource.fileName,
            x: 48,
            y: 48 + (videoIndex - 1) * 280,
            metadata: {
                content: uploaded.url,
                storageKey: uploaded.storageKey,
                status: "success",
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType,
                resourceSha256: sha256,
            },
        });
    }

    return { inputMedia, setupOps, attachmentsByTurn };
}

export function collectCanvasMedia(finalState: unknown): MediaArtifact[] {
    const nodes = (finalState && typeof finalState === "object" && Array.isArray((finalState as { nodes?: unknown[] }).nodes)) ? (finalState as { nodes: Array<Record<string, unknown>> }).nodes : [];
    return nodes.flatMap((node) => {
        const metadata = node.metadata && typeof node.metadata === "object" ? node.metadata as Record<string, unknown> : {};
        const content = typeof metadata.content === "string" ? metadata.content : "";
        if (!content) return [];
        const type = String(node.type || "");
        const mediaType = type === "video" ? "video" : type === "audio" ? "audio" : type === "plugin:panorama" ? "panorama" : type === "image" ? "image" : null;
        if (!mediaType) return [];
        const status = metadata.status === "error" ? "error" : /^https?:\/\//.test(content) ? "external" : "ready";
        return [{
            role: "output" as const,
            nodeId: typeof node.id === "string" ? node.id : undefined,
            mediaType,
            title: typeof node.title === "string" ? node.title : undefined,
            source: content,
            sourceKind: typeof metadata.storageKey === "string" ? "uploaded-media" : "generated",
            mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : undefined,
            bytes: typeof metadata.bytes === "number" ? metadata.bytes : undefined,
            status,
            error: typeof metadata.errorDetails === "string" ? metadata.errorDetails : undefined,
        }];
    });
}

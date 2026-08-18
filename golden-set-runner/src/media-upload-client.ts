import path from "node:path";

export type UploadedMedia = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export type MediaUploadConfig = {
    baseUrl: string;
    cookie: string;
};

/**
 * 真实媒体上传必须显式提供产品 Web 服务地址与已授权会话。
 * Runner 不从浏览器、配置文件或钥匙串读取 Cookie，避免越权复用用户身份。
 */
export function readMediaUploadConfig(): MediaUploadConfig | null {
    const baseUrl = process.env.PILOT_MEDIA_BASE_URL?.replace(/\/$/, "");
    const cookie = process.env.PILOT_MEDIA_COOKIE?.trim();
    return baseUrl && cookie ? { baseUrl, cookie } : null;
}

export async function uploadVideoMedia(fileName: string, content: Buffer, mimeType: string, config = readMediaUploadConfig()): Promise<UploadedMedia> {
    if (!config) {
        throw new Error("视频真实上传需要 PILOT_MEDIA_BASE_URL 与 PILOT_MEDIA_COOKIE；未配置时 Runner 不会写入占位视频节点。");
    }
    const form = new FormData();
    const bytes = new Uint8Array(content.byteLength);
    bytes.set(content);
    form.append("file", new Blob([bytes], { type: mimeType }), path.basename(fileName));
    form.append("type", "video");
    const response = await fetch(`${config.baseUrl}/api/media/upload`, {
        method: "POST",
        headers: { cookie: config.cookie },
        body: form,
    });
    const payload = await response.json().catch(() => null) as Partial<UploadedMedia> & { error?: string } | null;
    if (!response.ok || !payload?.storageKey || !payload.url) {
        throw new Error(`视频上传失败：${payload?.error || `HTTP ${response.status}`}`);
    }
    return {
        storageKey: payload.storageKey,
        url: new URL(payload.url, `${config.baseUrl}/`).toString(),
        bytes: typeof payload.bytes === "number" ? payload.bytes : content.byteLength,
        mimeType: payload.mimeType || mimeType,
    };
}

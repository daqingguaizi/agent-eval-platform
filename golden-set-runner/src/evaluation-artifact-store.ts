import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ArchivedMedia = {
  source: string;
  role: "input" | "output" | "unknown";
  nodeId?: string;
  nodeType?: string;
  title?: string;
  archivePath?: string;
  sha256?: string;
  mimeType?: string;
  bytes?: number;
  status: "archived" | "external" | "error";
  error?: string;
};

function sha256(content: Buffer) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function extension(contentType: string | null, source: string) {
  const fromUrl = path.extname(new URL(source, "http://localhost").pathname);
  if (fromUrl) return fromUrl.slice(0, 12);
  if (contentType?.includes("video")) return ".mp4";
  if (contentType?.includes("audio")) return ".mp3";
  if (contentType?.includes("image")) return ".png";
  return ".bin";
}

function collectMediaReferences(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^(https?:\/\/|\/api\/media\/|\/api\/images\/)/.test(value)) output.add(value);
    return output;
  }
  if (Array.isArray(value)) value.forEach((item) => collectMediaReferences(item, output));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectMediaReferences(item, output));
  return output;
}

function safeSourceUrl(baseUrl: string, source: string) {
  return new URL(source, baseUrl).toString();
}

function generatedDescendants(
  nodes: Array<{ id?: string; type?: string }>,
  connections: Array<{ fromNodeId?: string; toNodeId?: string }>,
) {
  const children = new Map<string, string[]>();
  for (const edge of connections) {
    if (!edge.fromNodeId || !edge.toNodeId) continue;
    children.set(edge.fromNodeId, [...(children.get(edge.fromNodeId) || []), edge.toNodeId]);
  }
  const generated = new Set<string>();
  const pending = nodes.filter((node) => node.type === "config" && node.id).map((node) => node.id as string);
  while (pending.length) {
    const parentId = pending.shift() as string;
    for (const childId of children.get(parentId) || []) {
      if (generated.has(childId)) continue;
      generated.add(childId);
      pending.push(childId);
    }
  }
  return generated;
}

type CanvasMediaNode = {
  id?: string;
  type?: string;
  title?: string;
  metadata?: { content?: string; mimeType?: string; status?: string; generationType?: string };
};

function isMediaNode(node: CanvasMediaNode) {
  return ["image", "video", "audio", "plugin:panorama"].includes(node.type || "");
}

function isPluginGeneratedOutput(node: CanvasMediaNode) {
  return node.type === "plugin:panorama"
    && node.metadata?.status === "success"
    && ["generation", "edit"].includes(node.metadata?.generationType || "");
}

function mediaEntries(canvas: { payload?: { nodes?: CanvasMediaNode[]; connections?: Array<{ fromNodeId?: string; toNodeId?: string }> } }) {
  const payload = canvas.payload || {};
  const nodes = payload.nodes || [];
  const generatedNodeIds = generatedDescendants(nodes, payload.connections || []);
  const entries = new Map<string, Omit<ArchivedMedia, "status">>();
  const roleRank = { unknown: 0, input: 1, output: 2 } as const;
  for (const node of nodes) {
    const source = node.metadata?.content;
    if (!source || !/^(https?:\/\/|\/api\/media\/|\/api\/images\/)/.test(source)) continue;
    const role = generatedNodeIds.has(node.id || "") || isPluginGeneratedOutput(node)
      ? "output"
      : isMediaNode(node) ? "input" : "unknown";
    const entry = { source, role, nodeId: node.id, nodeType: node.type, title: node.title, mimeType: node.metadata?.mimeType } as Omit<ArchivedMedia, "status">;
    const previous = entries.get(source);
    // 同一文件可同时出现在批量生成根节点和子节点；输出血缘优先，避免后续节点覆盖为输入。
    if (!previous || roleRank[entry.role] > roleRank[previous.role]) entries.set(source, entry);
  }
  for (const source of collectMediaReferences(canvas)) {
    if (!entries.has(source)) entries.set(source, { source, role: "unknown" });
  }
  return [...entries.values()];
}

export async function archiveCanvasSnapshot(options: {
  runDir: string;
  caseId: string;
  canvasId: string;
  cookie: string;
  baseUrl: string;
}) {
  const { runDir, caseId, canvasId, cookie, baseUrl } = options;
  const caseDir = path.join(runDir, caseId);
  const snapshotDir = path.join(caseDir, "evidence");
  const mediaDir = path.join(snapshotDir, "media");
  await fs.mkdir(mediaDir, { recursive: true });
  const response = await fetch(`${baseUrl}/api/workspace/canvases/${encodeURIComponent(canvasId)}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`无法归档持久画布：${response.status} ${await response.text()}`);
  const canvas = await response.json();
  const snapshotPath = path.join(snapshotDir, "canvas-snapshot.json");
  await fs.writeFile(snapshotPath, `${JSON.stringify(canvas, null, 2)}\n`);

  const media: ArchivedMedia[] = [];
  for (const entry of mediaEntries(canvas)) {
    try {
      const mediaResponse = await fetch(safeSourceUrl(baseUrl, entry.source), { headers: { cookie }, signal: AbortSignal.timeout(30_000) });
      if (!mediaResponse.ok) {
        media.push({ ...entry, status: "external", error: `下载返回 ${mediaResponse.status}` });
        continue;
      }
      const content = Buffer.from(await mediaResponse.arrayBuffer());
      const digest = sha256(content);
      const mimeType = mediaResponse.headers.get("content-type") || entry.mimeType;
      const fileName = `${digest}${extension(mimeType || null, entry.source)}`;
      const destination = path.join(mediaDir, fileName);
      await fs.access(destination).catch(() => fs.writeFile(destination, content));
      media.push({ ...entry, archivePath: path.relative(caseDir, destination), sha256: digest, mimeType, bytes: content.byteLength, status: "archived" });
    } catch (error) {
      media.push({ ...entry, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const manifest = { archivedAt: new Date().toISOString(), canvasId, snapshot: path.relative(caseDir, snapshotPath), media };
  await fs.writeFile(path.join(snapshotDir, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { canvas, manifest };
}

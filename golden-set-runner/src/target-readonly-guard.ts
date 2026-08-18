import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TARGET_ROOT = path.resolve(HERE, "..", "..", "..", "products", "echo-infinite-canvas-main");

const SOURCE_ROOTS = ["canvas-agent/src", "web/src/app/(user)/canvas/utils"];
const FIXED_FILES = ["canvas-agent/package.json", "web/package.json"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs", ".json"]);

export type TargetFingerprint = {
    targetRoot: string;
    files: number;
    manifestSha256: string;
};

export type AgentWorkspace = {
    canvasId: string;
    workspacePath: string;
    activeThreadId?: string;
    pinnedThreadIds?: string[];
};

function sha256(value: string | Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

async function collectFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(fullPath));
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(fullPath);
        }
    }
    return files;
}

/** 仅对 Runner 直接使用的产品源文件和包描述生成清单，不写入被测项目。 */
export async function fingerprintTarget(): Promise<TargetFingerprint> {
    const sourceFiles = (await Promise.all(SOURCE_ROOTS.map(async (relative) => {
        const directory = path.join(TARGET_ROOT, relative);
        return collectFiles(directory);
    }))).flat();
    const files = [...sourceFiles, ...FIXED_FILES.map((relative) => path.join(TARGET_ROOT, relative))].sort();
    const manifest = await Promise.all(files.map(async (file) => {
        const content = await fs.readFile(file);
        return `${path.relative(TARGET_ROOT, file)}\0${sha256(content)}`;
    }));
    return { targetRoot: TARGET_ROOT, files: files.length, manifestSha256: sha256(manifest.join("\n")) };
}

export function assertTargetUnchanged(before: TargetFingerprint, after: TargetFingerprint) {
    if (before.targetRoot !== after.targetRoot || before.files !== after.files || before.manifestSha256 !== after.manifestSha256) {
        throw new Error(`被测项目源码指纹发生变化：${before.manifestSha256} -> ${after.manifestSha256}。已停止后续 Case，Runner 不会尝试还原目标文件。`);
    }
}

function isInside(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/** 查询产品公开接口，并拒绝落在被测项目根目录下的 Agent workspace。 */
export async function getAndVerifyAgentWorkspace(url: string, token: string, canvasId: string): Promise<AgentWorkspace> {
    const requestUrl = `${url}/agent/codex/workspace?canvasId=${encodeURIComponent(canvasId)}&token=${encodeURIComponent(token)}`;
    const response = await fetch(requestUrl, { headers: { "x-canvas-agent-token": token } });
    const payload = await response.json().catch(() => null) as { ok?: boolean; workspace?: AgentWorkspace; error?: string } | null;
    if (!response.ok || !payload?.ok || !payload.workspace?.workspacePath) {
        throw new Error(`无法查询 Agent workspace：${payload?.error || `HTTP ${response.status}`}`);
    }
    const workspace = payload.workspace;
    if (isInside(TARGET_ROOT, path.resolve(workspace.workspacePath))) {
        throw new Error(`Agent workspace 位于被测项目目录内，拒绝运行：${workspace.workspacePath}`);
    }
    return workspace;
}

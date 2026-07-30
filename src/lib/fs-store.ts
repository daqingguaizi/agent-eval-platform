import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { glob } from "glob";
import type { DatasetSplit, EvalCase } from "@/types";
import { validateEvalCase } from "@/types";

const ASSET_ROOT = path.resolve(process.cwd());
const ASSET_DIRS = {
  standards: path.join(ASSET_ROOT, "standards"),
  datasets: path.join(ASSET_ROOT, "datasets"),
  fixtures: path.join(ASSET_ROOT, "fixtures"),
  specs: path.join(ASSET_ROOT, "specs"),
  skills: path.join(ASSET_ROOT, "skills"),
  loops: path.join(ASSET_ROOT, "loops"),
} as const;

type AssetKind = keyof typeof ASSET_DIRS;

function resolveAssetPath(kind: AssetKind, relativePath: string): string {
  const root = ASSET_DIRS[kind];
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("非法资产路径");
  }
  return resolved;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readYaml<T = unknown>(kind: AssetKind, relativePath: string): Promise<T> {
  return yaml.load(await fs.readFile(resolveAssetPath(kind, relativePath), "utf-8")) as T;
}

export async function readYamlDocuments<T = unknown>(kind: AssetKind, relativePath: string): Promise<T[]> {
  return yaml.loadAll(await fs.readFile(resolveAssetPath(kind, relativePath), "utf-8")).filter(Boolean) as T[];
}

export async function readMarkdown(kind: AssetKind, relativePath: string): Promise<string> {
  return fs.readFile(resolveAssetPath(kind, relativePath), "utf-8");
}

export async function readJson<T = unknown>(kind: AssetKind, relativePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(resolveAssetPath(kind, relativePath), "utf-8")) as T;
}

export async function listFiles(kind: AssetKind, pattern = "**/*.yaml"): Promise<string[]> {
  const dir = ASSET_DIRS[kind];
  await ensureDir(dir);
  return (await glob(pattern, { cwd: dir, nodir: true })).sort();
}

export async function readAllYaml<T = unknown>(kind: AssetKind, pattern = "**/*.yaml"): Promise<Array<{ file: string; data: T }>> {
  return Promise.all((await listFiles(kind, pattern)).map(async (file) => ({ file, data: await readYaml<T>(kind, file) })));
}

export async function writeYaml(kind: AssetKind, relativePath: string, data: unknown): Promise<void> {
  const filePath = resolveAssetPath(kind, relativePath);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), "utf-8");
}

export async function writeMarkdown(kind: AssetKind, relativePath: string, content: string): Promise<void> {
  const filePath = resolveAssetPath(kind, relativePath);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf-8");
}

export async function deleteFile(kind: AssetKind, relativePath: string): Promise<void> {
  await fs.unlink(resolveAssetPath(kind, relativePath));
}

export async function fileExists(kind: AssetKind, relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolveAssetPath(kind, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function inspectDataset(relativePath: string): Promise<{ cases: EvalCase[]; split: DatasetSplit; contentHash: string; issues: string[] }> {
  const filePath = resolveAssetPath("datasets", relativePath);
  const content = await fs.readFile(filePath, "utf-8");
  const cases = yaml.loadAll(content).filter(Boolean) as EvalCase[];
  const issues = cases.flatMap((item, index) => validateEvalCase(item).issues.map((issue) => `第 ${index + 1} 条：${issue}`));
  const split = cases[0]?.dataset_split ?? "capability";
  if (cases.some((item) => item.dataset_split && item.dataset_split !== split)) issues.push("同一数据集文件只能包含一个 dataset_split");
  return { cases, split, contentHash: createHash("sha256").update(content).digest("hex"), issues };
}

export async function inspectFixture(relativePath: string): Promise<{ issues: string[]; canvas?: unknown }> {
  try {
    const filePath = resolveAssetPath("fixtures", relativePath);
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as Record<string, unknown>;
    return { issues: [], canvas: data.canvas ?? data };
  } catch {
    return { issues: [`Fixture 文件不存在或格式错误：${relativePath}`] };
  }
}

export function getAssetDir(kind: AssetKind): string {
  return ASSET_DIRS[kind];
}

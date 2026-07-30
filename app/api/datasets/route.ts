import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { listFiles, getAssetDir } from "@/lib/fs-store";
import { ok, fail } from "@/lib/api-response";

/** GET /api/datasets — 列出所有评测集文件及其用例 */
export async function GET() {
  try {
    const files = await listFiles("datasets", "**/*.yaml");
    const results = [];
    for (const file of files) {
      const filePath = path.join(getAssetDir("datasets"), file);
      const content = await fs.readFile(filePath, "utf-8");
      // YAML 多文档用 --- 分隔，需要用 loadAll
      const docs = yaml.loadAll(content) as unknown[];
      const cases = docs.filter(Boolean);
      results.push({ file, caseCount: cases.length, cases });
    }
    return NextResponse.json(ok(results));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

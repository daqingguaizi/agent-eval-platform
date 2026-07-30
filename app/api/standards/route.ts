import { NextResponse } from "next/server";
import { readYaml, listFiles } from "@/lib/fs-store";
import { ok, fail } from "@/lib/api-response";

/** GET /api/standards — 列出所有构建标准文件 */
export async function GET() {
  try {
    const files = await listFiles("standards", "**/*.yaml");
    const results = [];
    for (const file of files) {
      const data = await readYaml("standards", file);
      results.push({ file, data });
    }
    return NextResponse.json(ok(results));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

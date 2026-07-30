import { NextRequest, NextResponse } from "next/server";
import { readYaml, writeYaml, fileExists } from "@/lib/fs-store";
import { ok, fail } from "@/lib/api-response";

type Params = { params: Promise<{ file: string }> };

/** GET /api/standards/:file — 读取单个标准文件 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { file } = await params;
    const exists = await fileExists("standards", file);
    if (!exists) {
      return NextResponse.json(fail("文件不存在"), { status: 404 });
    }
    const data = await readYaml("standards", file);
    return NextResponse.json(ok({ file, data }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** PUT /api/standards/:file — 更新标准文件（整体覆盖写回） */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { file } = await params;
    const body = await req.json();
    await writeYaml("standards", file, body);
    return NextResponse.json(ok({ file }, "已保存"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

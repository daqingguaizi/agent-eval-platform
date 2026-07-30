import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getAssetDir, listFiles } from "@/lib/fs-store";
import { ok, fail } from "@/lib/api-response";

type Params = { params: Promise<{ path: string[] }> };

/** 从多文档 YAML 文件中读取所有用例 */
async function readCasesFromFile(filePath: string) {
  const content = await fs.readFile(filePath, "utf-8");
  const docs = yaml.loadAll(content) as Record<string, unknown>[];
  return docs.filter(Boolean);
}

/** 将用例数组写回多文档 YAML */
async function writeCasesToFile(
  filePath: string,
  cases: Record<string, unknown>[]
) {
  const content = cases
    .map((c) => yaml.dump(c, { lineWidth: 120, noRefs: true, sortKeys: false }))
    .join("---\n");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/** GET /api/datasets/[...path]
 *  - /api/datasets/echo/golden.yaml → 返回该文件所有用例
 *  - 支持 query 参数筛选: ?category=&priority=&source=&tag=&status=
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const segments = (await params).path;
    const relativePath = segments.join("/");
    const filePath = path.join(getAssetDir("datasets"), relativePath);

    // 检查是请求目录还是文件
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return NextResponse.json(fail("路径不存在"), { status: 404 });
    }

    if (stat.isDirectory()) {
      // 列出该目录下所有 yaml 文件
      const files = await listFiles("datasets", `${relativePath}/**/*.yaml`);
      const results = [];
      for (const file of files) {
        const fp = path.join(getAssetDir("datasets"), file);
        const cases = await readCasesFromFile(fp);
        results.push({ file, caseCount: cases.length });
      }
      return NextResponse.json(ok(results));
    }

    // 文件：读取所有用例并按 query 筛选
    const cases = await readCasesFromFile(filePath);

    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const priority = url.searchParams.get("priority");
    const source = url.searchParams.get("source");
    const tag = url.searchParams.get("tag");
    const status = url.searchParams.get("status");
    const caseKind = url.searchParams.get("caseKind");

    let filtered = cases;
    if (category)
      filtered = filtered.filter((c) => c.category === category);
    if (priority)
      filtered = filtered.filter((c) => c.priority === priority);
    if (source) filtered = filtered.filter((c) => c.source === source);
    if (status) filtered = filtered.filter((c) => c.status === status);
    if (caseKind)
      filtered = filtered.filter((c) => c.caseKind === caseKind);
    if (tag)
      filtered = filtered.filter(
        (c) => Array.isArray(c.tags) && (c.tags as string[]).includes(tag)
      );

    return NextResponse.json(
      ok({
        file: relativePath,
        total: cases.length,
        filtered: filtered.length,
        cases: filtered,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** PUT /api/datasets/[...path] — 更新某条用例（by id） */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const segments = (await params).path;
    const relativePath = segments.join("/");
    const filePath = path.join(getAssetDir("datasets"), relativePath);
    const body = (await req.json()) as { id: string } & Record<string, unknown>;

    if (!body.id) {
      return NextResponse.json(fail("缺少 id 字段"), { status: 400 });
    }

    const cases = await readCasesFromFile(filePath);
    const idx = cases.findIndex((c) => c.id === body.id);
    if (idx === -1) {
      return NextResponse.json(fail(`用例 ${body.id} 不存在`), {
        status: 404,
      });
    }

    cases[idx] = { ...cases[idx], ...body };
    await writeCasesToFile(filePath, cases);

    return NextResponse.json(ok(cases[idx], "已保存"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** POST /api/datasets/[...path] — 新增用例（追加到文件末尾） */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const segments = (await params).path;
    const relativePath = segments.join("/");
    const filePath = path.join(getAssetDir("datasets"), relativePath);
    const body = (await req.json()) as { id: string } & Record<string, unknown>;

    if (!body.id) {
      return NextResponse.json(fail("缺少 id 字段"), { status: 400 });
    }

    let cases: Record<string, unknown>[];
    try {
      cases = await readCasesFromFile(filePath);
    } catch {
      cases = [];
    }

    if (cases.some((c) => c.id === body.id)) {
      return NextResponse.json(fail(`用例 ${body.id} 已存在`), {
        status: 409,
      });
    }

    cases.push(body);
    await writeCasesToFile(filePath, cases);

    return NextResponse.json(ok(body, "已添加"), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** DELETE /api/datasets/[...path]?caseId=xxx — 删除某条用例 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const segments = (await params).path;
    const relativePath = segments.join("/");
    const filePath = path.join(getAssetDir("datasets"), relativePath);

    const url = new URL(req.url);
    const caseId = url.searchParams.get("caseId");
    if (!caseId) {
      return NextResponse.json(fail("缺少 caseId 参数"), { status: 400 });
    }

    const cases = await readCasesFromFile(filePath);
    const filtered = cases.filter((c) => c.id !== caseId);
    if (filtered.length === cases.length) {
      return NextResponse.json(fail(`用例 ${caseId} 不存在`), {
        status: 404,
      });
    }

    await writeCasesToFile(filePath, filtered);
    return NextResponse.json(ok(null, "已删除"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

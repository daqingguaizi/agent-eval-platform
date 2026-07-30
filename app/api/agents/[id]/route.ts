import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { fileExists, readYaml } from "@/lib/fs-store";

type Params = { params: Promise<{ id: string }> };

/** GET /api/agents/:id — Agent 详情（含 standard 内容） */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) {
      return NextResponse.json(fail("Agent 不存在"), { status: 404 });
    }

    let standard = null;
    const exists = await fileExists("standards", agent.standardPath);
    if (exists) {
      standard = await readYaml("standards", agent.standardPath);
    }

    return NextResponse.json(
      ok({
        ...agent,
        agentTypes: JSON.parse(agent.agentTypes),
        standard,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** PATCH /api/agents/:id — 更新 Agent */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, agentTypes, standardPath } = body as {
      name?: string;
      agentTypes?: string[];
      standardPath?: string;
    };

    const existing = await prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(fail("Agent 不存在"), { status: 404 });
    }

    if (standardPath) {
      const exists = await fileExists("standards", standardPath);
      if (!exists) {
        return NextResponse.json(
          fail(`构建标准文件不存在：standards/${standardPath}`),
          { status: 400 }
        );
      }
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(agentTypes && { agentTypes: JSON.stringify(agentTypes) }),
        ...(standardPath && { standardPath }),
      },
    });

    return NextResponse.json(
      ok({ ...agent, agentTypes: JSON.parse(agent.agentTypes) })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** DELETE /api/agents/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(fail("Agent 不存在"), { status: 404 });
    }

    await prisma.agent.delete({ where: { id } });
    return NextResponse.json(ok(null, "已删除"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

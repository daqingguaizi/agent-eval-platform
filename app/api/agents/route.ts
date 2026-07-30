import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { fileExists } from "@/lib/fs-store";

/** GET /api/agents — 列出所有已声明的 Agent */
export async function GET() {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: "desc" },
    });
    const parsed = agents.map((a) => ({
      ...a,
      agentTypes: JSON.parse(a.agentTypes) as string[],
    }));
    return NextResponse.json(ok(parsed));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

/** POST /api/agents — 创建 Agent 声明 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, agentTypes, standardPath } = body as {
      id: string;
      name: string;
      agentTypes: string[];
      standardPath: string;
    };

    if (!id || !name || !agentTypes?.length || !standardPath) {
      return NextResponse.json(
        fail("缺少必填字段：id, name, agentTypes, standardPath"),
        { status: 400 }
      );
    }

    // 检查 standard 文件是否存在
    const exists = await fileExists("standards", standardPath);
    if (!exists) {
      return NextResponse.json(
        fail(`构建标准文件不存在：standards/${standardPath}`),
        { status: 400 }
      );
    }

    // 检查 id 唯一
    const existing = await prisma.agent.findUnique({ where: { id } });
    if (existing) {
      return NextResponse.json(fail(`Agent id "${id}" 已存在`), {
        status: 409,
      });
    }

    const agent = await prisma.agent.create({
      data: {
        id,
        name,
        agentTypes: JSON.stringify(agentTypes),
        standardPath,
      },
    });

    return NextResponse.json(
      ok({ ...agent, agentTypes: JSON.parse(agent.agentTypes) }),
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(msg), { status: 500 });
  }
}

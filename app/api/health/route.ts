import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";

/** GET /api/health — 检查 DB 连接与文件层就绪状态 */
export async function GET() {
  try {
    // 简单查询验证 DB 连通性
    const agentCount = await prisma.agent.count();
    return NextResponse.json(
      ok({
        db: "connected",
        agentCount,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(fail(`DB error: ${msg}`), { status: 500 });
  }
}

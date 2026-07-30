import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { connectionId } = await request.json() as { connectionId?: string };
    if (!connectionId) return NextResponse.json(fail("缺少 connectionId"), { status: 400 });
    const connection = await prisma.agentConnection.findFirst({ where: { id: connectionId, agentId: id } });
    if (!connection) return NextResponse.json(fail("连接不存在"), { status: 404 });
    if (connection.protocol === "simulate") {
      await prisma.agentConnection.update({ where: { id: connection.id }, data: { lastVerifiedAt: new Date(), status: "active" } });
      return NextResponse.json(ok({ reachable: true, protocol: "simulate", message: "模拟执行器可用" }));
    }
    if (!connection.endpoint) return NextResponse.json(fail("连接未配置 endpoint"), { status: 400 });
    let reachable = false;
    let message = "";
    try {
      const response = await fetch(connection.endpoint, { method: "OPTIONS", signal: AbortSignal.timeout(5000) });
      reachable = response.status < 500;
      message = `Endpoint 返回 ${response.status}`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    await prisma.agentConnection.update({ where: { id: connection.id }, data: { lastVerifiedAt: new Date(), status: reachable ? "active" : "unavailable" } });
    return NextResponse.json(ok({ reachable, protocol: connection.protocol, message, secretConfigured: Boolean(connection.secretEnvRef && process.env[connection.secretEnvRef]) }));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

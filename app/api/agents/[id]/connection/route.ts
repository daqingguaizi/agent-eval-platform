import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api-response";
import type { ExecutionProtocol, IsolationCapabilities } from "@/types";

const protocols: ExecutionProtocol[] = ["http", "callback", "simulate"];
type Params = { params: Promise<{ id: string }> };

function safeConnection(connection: { secretEnvRef: string | null; capabilities: string } & Record<string, unknown>) {
  const { secretEnvRef, capabilities, ...rest } = connection;
  return { ...rest, secretEnvRef: secretEnvRef ? `${secretEnvRef}（已配置）` : null, capabilities: JSON.parse(capabilities) as IsolationCapabilities };
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const connections = await prisma.agentConnection.findMany({ where: { agentId: id }, orderBy: { updatedAt: "desc" } });
    return NextResponse.json(ok(connections.map(safeConnection)));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json() as { protocol?: ExecutionProtocol; endpoint?: string; callbackPath?: string; secretEnvRef?: string; capabilities?: Partial<IsolationCapabilities>; timeoutMs?: number };
    if (!body.protocol || !protocols.includes(body.protocol)) return NextResponse.json(fail("protocol 必须为 http、callback 或 simulate"), { status: 400 });
    if (body.protocol !== "simulate" && !body.endpoint) return NextResponse.json(fail("真实执行连接必须提供 endpoint"), { status: 400 });
    if (body.endpoint && !/^https?:\/\//.test(body.endpoint)) return NextResponse.json(fail("endpoint 必须为 HTTP(S) 地址"), { status: 400 });
    if (body.secretEnvRef && !/^[A-Z][A-Z0-9_]*$/.test(body.secretEnvRef)) return NextResponse.json(fail("secretEnvRef 必须是服务端环境变量名"), { status: 400 });
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return NextResponse.json(fail("Agent 不存在"), { status: 404 });
    const capabilities: IsolationCapabilities = {
      sandbox: Boolean(body.capabilities?.sandbox),
      rollback: Boolean(body.capabilities?.rollback),
      testAccount: Boolean(body.capabilities?.testAccount),
      cleanupCallback: Boolean(body.capabilities?.cleanupCallback),
      supportsWriteOperations: Boolean(body.capabilities?.supportsWriteOperations),
    };
    const connection = await prisma.agentConnection.create({
      data: { agentId: id, protocol: body.protocol, endpoint: body.endpoint, callbackPath: body.callbackPath, secretEnvRef: body.secretEnvRef, capabilities: JSON.stringify(capabilities), timeoutMs: Math.min(Math.max(body.timeoutMs ?? 30000, 1000), 120000) },
    });
    return NextResponse.json(ok(safeConnection(connection)), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

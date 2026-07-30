import { NextRequest, NextResponse } from "next/server";
import { inspectDataset } from "@/lib/fs-store";
import { fail, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

const RUN_MODES = ["http", "callback", "simulate", "replay"] as const;
type RunMode = (typeof RUN_MODES)[number];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { agentId?: string; datasetFile?: string; mode?: RunMode; connectionId?: string; baselineRunId?: string; repeatOverride?: number };
    if (!body.agentId || !body.datasetFile) return NextResponse.json(fail("缺少 agentId 或 datasetFile"), { status: 400 });
    const mode = body.mode ?? "simulate";
    if (!RUN_MODES.includes(mode)) return NextResponse.json(fail("mode 必须为 http、callback、simulate 或 replay"), { status: 400 });
    const agent = await prisma.agent.findUnique({ where: { id: body.agentId } });
    if (!agent) return NextResponse.json(fail("Agent 不存在，请先完成 Agent 声明"), { status: 404 });
    const datasetInfo = await inspectDataset(body.datasetFile);
    if (datasetInfo.issues.length) return NextResponse.json(fail(`评测集不符合 EvalCase 契约：${datasetInfo.issues.join("；")}`), { status: 400 });
    if (!datasetInfo.cases.length || datasetInfo.cases.some((item) => item.agent !== body.agentId)) return NextResponse.json(fail("评测集不能为空且所有用例必须属于所选 Agent"), { status: 400 });
    let connectionId: string | undefined;
    if (mode !== "simulate" && mode !== "replay") {
      const connection = await prisma.agentConnection.findFirst({ where: { id: body.connectionId, agentId: body.agentId, protocol: mode, status: "active" } });
      if (!connection) return NextResponse.json(fail("请选择可用且协议匹配的 Agent 连接"), { status: 400 });
      connectionId = connection.id;
    }
    
    const dataset = await prisma.dataset.upsert({
      where: { agentId_filePath: { agentId: body.agentId, filePath: body.datasetFile } },
      create: { agentId: body.agentId, filePath: body.datasetFile, split: datasetInfo.split, version: datasetInfo.contentHash.slice(0, 12), contentHash: datasetInfo.contentHash, caseCount: datasetInfo.cases.length },
      update: { split: datasetInfo.split, version: datasetInfo.contentHash.slice(0, 12), contentHash: datasetInfo.contentHash, caseCount: datasetInfo.cases.length },
    });
    const run = await prisma.run.create({
      data: {
        agentId: body.agentId,
        datasetId: dataset.id,
        connectionId,
        baselineRunId: body.baselineRunId,
        source: mode === "simulate" ? "simulate" : mode === "replay" ? "replay" : "eval",
        mode,
        configuration: JSON.stringify({ datasetFile: body.datasetFile, repeatOverride: body.repeatOverride }),
      },
    });
    return NextResponse.json(ok({ runId: run.id, status: run.status, mode: run.mode, dataset: { file: body.datasetFile, cases: dataset.caseCount, split: dataset.split }, worker: "请确保 npm run worker 正在运行" }), { status: 201 });
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    const runs = await prisma.run.findMany({
      where: { ...(query.get("agentId") ? { agentId: query.get("agentId")! } : {}), ...(query.get("status") ? { status: query.get("status")! } : {}) },
      include: { dataset: true, connection: { select: { id: true, protocol: true, status: true } }, _count: { select: { trials: true } } },
      orderBy: { queuedAt: "desc" },
      take: 50,
    });
    return NextResponse.json(ok(runs.map((run) => ({ ...run, summary: run.summary ? JSON.parse(run.summary) : null, gateResult: run.gateResult ? JSON.parse(run.gateResult) : null }))));
  } catch (error) {
    return NextResponse.json(fail(error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}

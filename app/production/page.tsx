"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Select, Space, Table, Tag, Typography, message } from "antd";
import { CloudDownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { get, post } from "@/lib/http";

interface Agent { id: string; name: string }
interface Trace { id: string; traceId: string; agentId: string; sessionId: string; createdAt: string }
interface Dataset { file: string; cases: Array<{ id: string; agent: string }> }
export default function ProductionPage() {
  const [agents, setAgents] = useState<Agent[]>([]); const [agentId, setAgentId] = useState(""); const [traces, setTraces] = useState<Trace[]>([]); const [datasets, setDatasets] = useState<Dataset[]>([]);
  const load = async () => { const [agentItems, datasetItems] = await Promise.all([get<Agent[]>("/api/agents"), get<Dataset[]>("/api/datasets")]); setAgents(agentItems); setDatasets(datasetItems); const id = agentId || agentItems[0]?.id || ""; setAgentId(id); if (id) { const data = await get<{ recent: Trace[] }>(`/api/production/ingest?agentId=${id}`); setTraces(data.recent); } };
  useEffect(() => { void load(); }, []); useEffect(() => { if (agentId) get<{ recent: Trace[] }>(`/api/production/ingest?agentId=${agentId}`).then((data) => setTraces(data.recent)); }, [agentId]);
  const replay = async (trace: Trace) => { const dataset = datasets.find((item) => item.cases.some((entry) => entry.agent === agentId)); const caseId = dataset?.cases.find((item) => item.agent === agentId)?.id; if (!dataset || !caseId) { message.warning("请先准备该 Agent 的评测集与 Case"); return; } const result = await post<{ runId: string }>("/api/production/replay", { traceRecordId: trace.id, datasetFile: dataset.file, caseId }); message.success(`Replay Run 已完成：${result.runId}`); };
  return <div><Typography.Title level={3}><CloudDownloadOutlined /> 线上采集与 Replay</Typography.Title><Alert type="info" showIcon style={{ marginBottom: 16 }} message="生产系统必须以 HMAC 签名调用 /api/production/ingest，并携带授权引用、事件幂等键和五项入库标准。该页面只查看脱敏后的入库结果，不暴露采集密钥。" /><Card style={{ marginBottom: 16 }}><Space><Select value={agentId} onChange={setAgentId} style={{ width: 220 }} options={agents.map((item) => ({ value: item.id, label: item.name || item.id }))} /><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Tag color="blue">授权 · 签名 · 脱敏 · 幂等</Tag></Space></Card><Card title="已授权的生产 Trace"><Table rowKey="id" dataSource={traces} columns={[{ title: "Trace", dataIndex: "traceId", ellipsis: true }, { title: "Session", dataIndex: "sessionId", ellipsis: true }, { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN") }, { title: "操作", render: (_: unknown, row: Trace) => <Button type="link" onClick={() => void replay(row)}>创建隔离 Replay</Button> }]} /></Card></div>;
}

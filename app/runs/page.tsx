"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Drawer, InputNumber, Row, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { get, post } from "@/lib/http";

interface Agent { id: string; name: string }
interface Dataset { file: string; caseCount: number; cases: Array<{ agent: string }> }
interface Connection { id: string; protocol: "http" | "callback" | "simulate"; status: string }
interface Run { id: string; agentId: string; mode: string; status: string; gatePassed: boolean | null; createdAt: string; summary: { pass?: number; fail?: number; passRate?: number; caseResults?: unknown[] } | null; _count?: { trials: number } }

export default function RunsPage() {
  const [agents, setAgents] = useState<Agent[]>([]); const [datasets, setDatasets] = useState<Dataset[]>([]); const [connections, setConnections] = useState<Connection[]>([]); const [runs, setRuns] = useState<Run[]>([]);
  const [agentId, setAgentId] = useState(""); const [datasetFile, setDatasetFile] = useState(""); const [mode, setMode] = useState<"http" | "callback" | "simulate">("simulate"); const [connectionId, setConnectionId] = useState<string>(); const [repeatOverride, setRepeatOverride] = useState<number>(); const [busy, setBusy] = useState(false); const [detail, setDetail] = useState<Run | null>(null);
  const load = async () => { const [agentItems, datasetItems, runItems] = await Promise.all([get<Agent[]>("/api/agents"), get<Dataset[]>("/api/datasets"), get<Run[]>("/api/runs")]); setAgents(agentItems); setDatasets(datasetItems); setRuns(runItems); setAgentId((current) => current || agentItems[0]?.id || ""); };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (agentId) { get<Connection[]>(`/api/agents/${agentId}/connection`).then(setConnections); const available = datasets.filter((item) => item.cases.every((entry) => entry.agent === agentId)); setDatasetFile((current) => available.some((item) => item.file === current) ? current : available[0]?.file || ""); } }, [agentId, datasets]);
  useEffect(() => { setConnectionId(connections.find((item) => item.protocol === mode && item.status === "active")?.id); }, [mode, connections]);
  const start = async () => { try { setBusy(true); const result = await post<{ runId: string; worker: string }>("/api/runs", { agentId, datasetFile, mode, connectionId, repeatOverride }); message.success(`Run 已入队：${result.runId.slice(0, 10)}…`); message.info(result.worker); await load(); } catch (error) { message.error(error instanceof Error ? error.message : "创建 Run 失败"); } finally { setBusy(false); } };
  const cancel = async (id: string) => { await post(`/api/runs/${id}/cancel`, { reason: "页面取消" }); message.success("Run 已取消"); void load(); };
  return <div>
    <Typography.Title level={3}>跑测中心</Typography.Title>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="真实 Agent Run 由 Worker 调度。请先在"Agent 接入"完成 HTTP 或 Bridge 连接，并确保 npm run worker 正在运行。" />
    <Card style={{ marginBottom: 16 }}><Space wrap>
      <Select value={agentId} onChange={setAgentId} style={{ width: 170 }} options={agents.map((item) => ({ value: item.id, label: item.name || item.id }))} placeholder="选择 Agent" />
      <Select value={datasetFile} onChange={setDatasetFile} style={{ width: 240 }} options={datasets.filter((item) => item.cases.every((entry) => entry.agent === agentId)).map((item) => ({ value: item.file, label: `${item.file}（${item.caseCount} 条）` }))} placeholder="选择评测集" />
      <Select value={mode} onChange={setMode} style={{ width: 150 }} options={[{ value: "simulate", label: "模拟执行" }, { value: "http", label: "真实 HTTP Agent" }, { value: "callback", label: "Bridge 回调" }]} />
      {mode !== "simulate" && <Select value={connectionId} onChange={setConnectionId} style={{ width: 180 }} options={connections.filter((item) => item.protocol === mode && item.status === "active").map((item) => ({ value: item.id, label: `${item.protocol} · ${item.id.slice(0, 8)}` }))} placeholder="选择可用连接" />}
      <InputNumber value={repeatOverride} onChange={(value) => setRepeatOverride(value ?? undefined)} min={1} max={20} placeholder="重复次数（可选）" />
      <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} disabled={!agentId || !datasetFile || (mode !== "simulate" && !connectionId)} onClick={() => void start()}>创建 Run</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
    </Space></Card>
    <Card title="Run 队列与历史"><Table rowKey="id" dataSource={runs} pagination={{ pageSize: 12 }} columns={[
      { title: "Run", dataIndex: "id", ellipsis: true }, { title: "Agent", dataIndex: "agentId", width: 100 }, { title: "模式", dataIndex: "mode", width: 100, render: (value: string) => <Tag>{value}</Tag> }, { title: "状态", dataIndex: "status", width: 130, render: (value: string) => <Tag color={value === "completed" ? "green" : value.includes("fail") ? "red" : "blue"}>{value}</Tag> }, { title: "Trial", key: "trials", width: 80, render: (_: unknown, row: Run) => row._count?.trials ?? "-" }, { title: "门禁", dataIndex: "gatePassed", width: 80, render: (value: boolean | null) => value === null ? "-" : <Tag color={value ? "green" : "red"}>{value ? "PASS" : "FAIL"}</Tag> }, { title: "通过率", key: "rate", width: 100, render: (_: unknown, row: Run) => row.summary ? `${Math.round((row.summary.passRate ?? 0) * 100)}%` : "-" }, { title: "操作", width: 150, render: (_: unknown, row: Run) => <Space><Button type="link" onClick={() => setDetail(row)}>详情</Button>{["queued", "running", "awaiting_callback"].includes(row.status) && <Button danger type="link" icon={<StopOutlined />} onClick={() => void cancel(row.id)}>取消</Button>}</Space> },
    ]} /></Card>
    <Drawer title={`Run 详情 · ${detail?.id}`} open={Boolean(detail)} onClose={() => setDetail(null)} width={620}>{detail && <><Row gutter={12}><Col span={8}><Statistic title="状态" value={detail.status} /></Col><Col span={8}><Statistic title="通过" value={detail.summary?.pass ?? 0} /></Col><Col span={8}><Statistic title="失败" value={detail.summary?.fail ?? 0} /></Col></Row><pre style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>{JSON.stringify(detail.summary, null, 2)}</pre></>}</Drawer>
  </div>;
}

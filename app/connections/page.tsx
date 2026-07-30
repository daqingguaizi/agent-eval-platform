"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import { CheckCircleOutlined, LinkOutlined, PlusOutlined } from "@ant-design/icons";
import { get, post } from "@/lib/http";

interface Agent { id: string; name: string }
interface Connection { id: string; protocol: string; endpoint?: string; status: string; timeoutMs: number; capabilities: Record<string, boolean> }
const capabilities = ["sandbox", "rollback", "testAccount", "cleanupCallback", "supportsWriteOperations"];

export default function ConnectionsPage() {
  const searchParams = useSearchParams();
  const presetAgentId = searchParams.get("agentId");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form] = Form.useForm();
  const load = async (id = agentId) => { if (id) setConnections(await get<Connection[]>(`/api/agents/${id}/connection`)); };
  useEffect(() => { get<Agent[]>("/api/agents").then((items) => { setAgents(items); const initial = presetAgentId && items.some((item) => item.id === presetAgentId) ? presetAgentId : items[0]?.id ?? ""; setAgentId(initial); }); }, [presetAgentId]);
  useEffect(() => { void load(); }, [agentId]);
  const create = async () => {
    const value = await form.validateFields();
    const selected = new Set(value.capabilities ?? []);
    await post(`/api/agents/${agentId}/connection`, { ...value, capabilities: Object.fromEntries(capabilities.map((key) => [key, selected.has(key)])) });
    message.success("连接已保存"); form.resetFields(); void load();
  };
  const verify = async (connectionId: string) => {
    const result = await post<{ reachable: boolean; message: string; secretConfigured: boolean }>(`/api/agents/${agentId}/connection/verify`, { connectionId });
    result.reachable ? message.success(`${result.message}${result.secretConfigured ? "，密钥已配置" : ""}`) : message.error(result.message);
    void load();
  };
  return <div>
    <Typography.Title level={3}><LinkOutlined /> Agent 接入</Typography.Title>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="HTTP Agent 可同步返回 v1 Trace；浏览器内 Echo 请配置独立 Bridge，Bridge 完成后带 HMAC 回调 /api/executions/callback。" />
    <Card style={{ marginBottom: 16 }}><Space wrap><Select value={agentId} onChange={setAgentId} style={{ width: 220 }} options={agents.map((item) => ({ value: item.id, label: item.name || item.id }))} /><Tag color="blue">服务端只保存密钥环境变量名</Tag></Space></Card>
    <Card title="新增连接" style={{ marginBottom: 16 }}>
      <Form form={form} layout="vertical" initialValues={{ protocol: "http", timeoutMs: 30000 }}>
        <Form.Item name="protocol" label="执行协议" rules={[{ required: true }]}><Select options={[{ value: "http", label: "同步 HTTP 执行" }, { value: "callback", label: "Bridge 异步回调" }, { value: "simulate", label: "模拟执行" }]} /></Form.Item>
        <Form.Item name="endpoint" label="Agent / Bridge Endpoint"><Input placeholder="https://agent.example.com/eval/execute" /></Form.Item>
        <Form.Item name="callbackPath" label="Bridge 回调地址"><Input placeholder="/api/executions/callback" /></Form.Item>
        <Form.Item name="secretEnvRef" label="服务端密钥环境变量"><Input placeholder="ECHO_EVAL_BRIDGE_SECRET" /></Form.Item>
        <Form.Item name="timeoutMs" label="超时毫秒"><Input type="number" /></Form.Item>
        <Form.Item name="capabilities" label="隔离能力"><Checkbox.Group options={capabilities.map((value) => ({ value, label: value }))} /></Form.Item>
        <Button type="primary" icon={<PlusOutlined />} disabled={!agentId} onClick={() => void create()}>保存连接</Button>
      </Form>
    </Card>
    <Card title="已配置连接"><Table rowKey="id" dataSource={connections} pagination={false} columns={[
      { title: "协议", dataIndex: "protocol", render: (value: string) => <Tag>{value}</Tag> }, { title: "Endpoint", dataIndex: "endpoint", ellipsis: true }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "active" ? "green" : "red"}>{value}</Tag> }, { title: "隔离能力", dataIndex: "capabilities", render: (value: Record<string, boolean>) => Object.entries(value).filter(([, enabled]) => enabled).map(([key]) => <Tag key={key}>{key}</Tag>) }, { title: "操作", render: (_: unknown, row: Connection) => <Button size="small" icon={<CheckCircleOutlined />} onClick={() => void verify(row.id)}>连通性检测</Button> },
    ]} /></Card>
  </div>;
}

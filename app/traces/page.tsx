"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  Table,
  Tabs,
  Tag,
  Typography,
  Spin,
  Button,
  Space,
  Drawer,
  Descriptions,
  Timeline,
  Modal,
  Input,
  message,
  Select,
} from "antd";
import {
  ImportOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  RobotOutlined,
  SafetyOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface SpanData {
  spanId: string;
  kind: string;
  name: string;
  input?: unknown;
  output?: unknown;
  startTime: number;
  durationMs?: number;
  status?: string;
  error?: { message: string };
}

interface TraceData {
  id: string;
  traceId: string;
  agentId: string;
  sessionId: string;
  turnId: string;
  source: string;
  agentType: string;
  input: { message: string; attachments?: unknown[] };
  spans: SpanData[];
  outcome: { finalText: string; success?: boolean };
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

const spanKindIcon: Record<string, React.ReactNode> = {
  llm: <RobotOutlined />,
  tool: <ToolOutlined />,
  retrieval: <ThunderboltOutlined />,
  guardrail: <SafetyOutlined />,
};

const spanKindColor: Record<string, string> = {
  llm: "purple",
  tool: "blue",
  retrieval: "cyan",
  guardrail: "orange",
};

export default function TracesPage() {
  const [activeTab, setActiveTab] = useState<string>("eval");
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [detailTrace, setDetailTrace] = useState<TraceData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importAgentId, setImportAgentId] = useState("echo");
  const [importing, setImporting] = useState(false);

  const loadTraces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/traces?source=${activeTab}&page=${page}&pageSize=20`
      );
      const json = await res.json();
      if (json.code === 0) {
        setTraces(json.data.traces);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setPage(1);
  };

  const handleImport = async () => {
    try {
      setImporting(true);
      const raw = JSON.parse(importContent);
      const res = await fetch("/api/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: importAgentId,
          source: activeTab,
          raw,
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success(
          `导入成功：${json.data.traceId}（${json.data.spanCount} spans）`
        );
        setImportOpen(false);
        setImportContent("");
        loadTraces();
      } else {
        message.error(json.msg);
      }
    } catch (e) {
      message.error(
        "JSON 格式错误：" + (e instanceof Error ? e.message : "")
      );
    } finally {
      setImporting(false);
    }
  };

  // State diff 计算
  const computeDiff = (
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ) => {
    if (!before || !after) return null;
    const bNodes = (before.nodes as Array<Record<string, unknown>>) || [];
    const aNodes = (after.nodes as Array<Record<string, unknown>>) || [];
    const bConns = (before.connections as Array<Record<string, unknown>>) || [];
    const aConns = (after.connections as Array<Record<string, unknown>>) || [];

    const bIds = new Set(bNodes.map((n) => n.id));
    const aIds = new Set(aNodes.map((n) => n.id));
    const added = aNodes.filter((n) => !bIds.has(n.id));
    const removed = bNodes.filter((n) => !aIds.has(n.id));

    const bConnIds = new Set(bConns.map((c) => c.id));
    const aConnIds = new Set(aConns.map((c) => c.id));
    const addedConns = aConns.filter((c) => !bConnIds.has(c.id));
    const removedConns = bConns.filter((c) => !aConnIds.has(c.id));

    return { added, removed, addedConns, removedConns };
  };

  const columns = [
    {
      title: "Trace ID",
      dataIndex: "traceId",
      key: "traceId",
      width: 200,
      ellipsis: true,
    },
    {
      title: "Session",
      dataIndex: "sessionId",
      key: "sessionId",
      width: 140,
      ellipsis: true,
    },
    {
      title: "Agent",
      dataIndex: "agentId",
      key: "agentId",
      width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: "输入",
      key: "input",
      ellipsis: true,
      render: (_: unknown, r: TraceData) => (
        <Text style={{ maxWidth: 300 }} ellipsis>
          {r.input?.message}
        </Text>
      ),
    },
    {
      title: "Spans",
      key: "spans",
      width: 80,
      render: (_: unknown, r: TraceData) => (
        <Space>
          {r.spans.length}
          {r.spans.some((s) => s.status === "error") && (
            <Tag color="red">ERR</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "结果",
      key: "outcome",
      width: 200,
      ellipsis: true,
      render: (_: unknown, r: TraceData) => (
        <Text ellipsis style={{ maxWidth: 200 }}>
          {r.outcome?.finalText}
        </Text>
      ),
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_: unknown, r: TraceData) => (
        <Button
          size="small"
          type="link"
          icon={<EyeOutlined />}
          onClick={() => setDetailTrace(r)}
        >
          下钻
        </Button>
      ),
    },
  ];

  const diff = detailTrace
    ? computeDiff(detailTrace.stateBefore, detailTrace.stateAfter)
    : null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Trace 显化
        </Title>
        <Button
          type="primary"
          icon={<ImportOutlined />}
          onClick={() => setImportOpen(true)}
        >
          导入 Trace
        </Button>
      </div>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            {
              key: "eval",
              label: "上线前跑测 (eval)",
            },
            {
              key: "simulate",
              label: "模拟 (simulate)",
            },
            {
              key: "replay",
              label: "回放 (replay)",
            },
            {
              key: "imported",
              label: "导入 (imported)",
            },
            {
              key: "production",
              label: "线上真实 (production)",
            },
          ]}
        />

        <Table
          columns={columns}
          dataSource={traces}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条`,
          }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: "暂无 Trace，点击「导入 Trace」开始" }}
        />
      </Card>

      {/* 下钻 Drawer */}
      <Drawer
        title={`Trace 下钻 — ${detailTrace?.traceId ?? ""}`}
        open={!!detailTrace}
        onClose={() => setDetailTrace(null)}
        width={760}
      >
        {detailTrace && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Trace ID">
                {detailTrace.traceId}
              </Descriptions.Item>
              <Descriptions.Item label="Session">
                {detailTrace.sessionId}
              </Descriptions.Item>
              <Descriptions.Item label="Turn">
                {detailTrace.turnId}
              </Descriptions.Item>
              <Descriptions.Item label="Agent">
                {detailTrace.agentId}
              </Descriptions.Item>
              <Descriptions.Item label="Source">
                <Tag
                  color={
                    detailTrace.source === "eval"
                      ? "blue"
                      : detailTrace.source === "production"
                        ? "green"
                        : detailTrace.source === "simulate"
                          ? "default"
                          : "purple"
                  }
                >
                  {detailTrace.source}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Canvas Type">
                {(detailTrace.meta?.canvasType as string) ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label="输入" span={2}>
                {detailTrace.input?.message}
              </Descriptions.Item>
              <Descriptions.Item label="最终回复" span={2}>
                {detailTrace.outcome?.finalText}
              </Descriptions.Item>
            </Descriptions>

            {/* Spans 时间线 */}
            <Title level={5} style={{ marginTop: 20 }}>
              执行轨迹（Spans）
            </Title>
            <Timeline
              items={detailTrace.spans.map((s) => ({
                color:
                  s.status === "error"
                    ? "red"
                    : s.kind === "guardrail"
                      ? "orange"
                      : "blue",
                dot: spanKindIcon[s.kind],
                children: (
                  <Card size="small" style={{ marginBottom: 4 }}>
                    <Space>
                      <Tag color={spanKindColor[s.kind]}>{s.kind}</Tag>
                      <Text strong>{s.name}</Text>
                      {s.durationMs !== undefined && (
                        <Text type="secondary">{s.durationMs}ms</Text>
                      )}
                      {s.status === "error" && (
                        <Tag color="red">ERROR</Tag>
                      )}
                    </Space>
                    {s.input && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary">Input: </Text>
                        <pre
                          style={{
                            fontSize: 11,
                            background: "#f5f5f5",
                            padding: 6,
                            borderRadius: 4,
                            maxHeight: 120,
                            overflow: "auto",
                            margin: "2px 0 0",
                          }}
                        >
                          {JSON.stringify(s.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {s.output && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary">Output: </Text>
                        <pre
                          style={{
                            fontSize: 11,
                            background: "#f0f9eb",
                            padding: 6,
                            borderRadius: 4,
                            maxHeight: 120,
                            overflow: "auto",
                            margin: "2px 0 0",
                          }}
                        >
                          {JSON.stringify(s.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {s.error && (
                      <div style={{ marginTop: 4 }}>
                        <Tag color="red">
                          {s.error.message}
                        </Tag>
                      </div>
                    )}
                  </Card>
                ),
              }))}
            />

            {/* State Diff */}
            {diff && (
              <>
                <Title level={5}>画布状态 Diff</Title>
                <Card size="small">
                  {diff.added.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Tag color="green">+ 新增节点 ({diff.added.length})</Tag>
                      {diff.added.map((n) => (
                        <div
                          key={n.id as string}
                          style={{ marginLeft: 16, fontSize: 12 }}
                        >
                          <Tag>{(n.type as string) ?? "?"}</Tag>
                          {(n.title as string) ?? n.id}
                        </div>
                      ))}
                    </div>
                  )}
                  {diff.removed.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Tag color="red">
                        - 删除节点 ({diff.removed.length})
                      </Tag>
                      {diff.removed.map((n) => (
                        <div
                          key={n.id as string}
                          style={{ marginLeft: 16, fontSize: 12 }}
                        >
                          <Tag>{(n.type as string) ?? "?"}</Tag>
                          {(n.title as string) ?? n.id}
                        </div>
                      ))}
                    </div>
                  )}
                  {diff.addedConns.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Tag color="green">
                        + 新增连线 ({diff.addedConns.length})
                      </Tag>
                      {diff.addedConns.map((c) => (
                        <div
                          key={c.id as string}
                          style={{ marginLeft: 16, fontSize: 12 }}
                        >
                          {c.fromNodeId as string} →{" "}
                          {c.toNodeId as string}
                          {c.kind && <Tag style={{ marginLeft: 4 }}>{c.kind as string}</Tag>}
                        </div>
                      ))}
                    </div>
                  )}
                  {diff.removedConns.length > 0 && (
                    <div>
                      <Tag color="red">
                        - 删除连线 ({diff.removedConns.length})
                      </Tag>
                    </div>
                  )}
                  {diff.added.length === 0 &&
                    diff.removed.length === 0 &&
                    diff.addedConns.length === 0 &&
                    diff.removedConns.length === 0 && (
                      <Text type="secondary">无变化</Text>
                    )}
                </Card>
              </>
            )}

            {/* Rejections */}
            {detailTrace.meta?.rejections &&
              (detailTrace.meta.rejections as unknown[]).length > 0 && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>
                    安全约束拒绝
                  </Title>
                  <Card size="small">
                    {(
                      detailTrace.meta.rejections as Array<{
                        op: unknown;
                        reason: string;
                      }>
                    ).map((rej, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>
                        <Tag color="orange">REJECTED</Tag>
                        <Text>{rej.reason}</Text>
                        <pre style={{ fontSize: 11, margin: "2px 0 0" }}>
                          {JSON.stringify(rej.op, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </Card>
                </>
              )}

            {/* 原始快照 */}
            <Title level={5} style={{ marginTop: 16 }}>
              原始数据
            </Title>
            <Tabs
              size="small"
              items={[
                {
                  key: "before",
                  label: "stateBefore",
                  children: (
                    <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>
                      {JSON.stringify(detailTrace.stateBefore, null, 2)}
                    </pre>
                  ),
                },
                {
                  key: "after",
                  label: "stateAfter",
                  children: (
                    <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>
                      {JSON.stringify(detailTrace.stateAfter, null, 2)}
                    </pre>
                  ),
                },
                {
                  key: "meta",
                  label: "meta",
                  children: (
                    <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>
                      {JSON.stringify(detailTrace.meta, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* 导入 Modal */}
      <Modal
        title="导入 Trace（Echo 原始轨迹 JSON）"
        open={importOpen}
        onOk={handleImport}
        onCancel={() => {
          setImportOpen(false);
          setImportContent("");
        }}
        okText="导入"
        confirmLoading={importing}
        width={720}
      >
        <Space style={{ marginBottom: 8 }}>
          <Text>Agent:</Text>
          <Select
            value={importAgentId}
            onChange={setImportAgentId}
            style={{ width: 120 }}
            options={[{ value: "echo", label: "Echo" }]}
          />
          <Text type="secondary">
            导入到：
            <Tag color={activeTab === "pre-release" ? "blue" : "green"}>
              {activeTab}
            </Tag>
          </Text>
        </Space>
        <TextArea
          value={importContent}
          onChange={(e) => setImportContent(e.target.value)}
          rows={18}
          style={{ fontFamily: "monospace", fontSize: 12 }}
          placeholder='粘贴 Echo 原始轨迹 JSON（包含 sessionId, messages, snapshotBefore/After 等字段）'
        />
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          原始轨迹将经过 Echo adapter 自动归一化为 NormalizedTrace 后存入数据库
        </Paragraph>
      </Modal>
    </div>
  );
}

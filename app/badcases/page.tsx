"use client";

import React, { useState, useEffect } from "react";
import {
  Card, Button, Table, Tag, Space, Select, message, Drawer, Descriptions, Steps, Form, Input, Empty,
} from "antd";
import { BugOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { get, post } from "@/lib/http";

interface BadcaseItem {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  trace: { traceId: string; agentId: string; input: Record<string, unknown> };
  cluster: { id: string; rootCause: string; tool: string | null; size: number } | null;
  trial: { caseId?: string; risk?: string; scenario?: string; runId?: string } | null;
  triageResult: unknown;
  rca: {
    responsibleModule: string;
    problemCategory: string;
    problemEnum: string;
    confidence: number | null;
    report: string | null;
    fixActions: Array<{ action: string; owner: string; role: string; priority: string; verification: string }>;
  } | null;
}

const displayInput = (input?: Record<string, unknown>) => {
  if (!input) return "-";
  if (typeof input.message === "string") return input.message;
  return JSON.stringify(input);
};

interface AgentItem { id: string; name: string }

export default function BadcasesPage() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [badcases, setBadcases] = useState<BadcaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<BadcaseItem | null>(null);
  const [rcaForm] = Form.useForm();

  useEffect(() => {
    get<AgentItem[]>("/api/agents").then((data) => {
      setAgents(data ?? []);
      if (data?.length) setAgentId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (agentId) loadBadcases();
  }, [agentId]);

  const loadBadcases = async () => {
    setLoading(true);
    try {
      const data = await get<BadcaseItem[]>(`/api/badcases?agentId=${agentId}`);
      setBadcases(data ?? []);
    } catch (e) {
      message.error("加载失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  const handleIdentify = async () => {
    try {
      const result = await post<{ identified: number; clustered: number }>("/api/badcases", { agentId });
      message.success(`识别 ${result.identified} 条 Badcase，聚类 ${result.clustered} 条`);
      loadBadcases();
    } catch (e) {
      message.error("操作失败：" + (e instanceof Error ? e.message : ""));
    }
  };

  const handleSubmitRca = async () => {
    if (!selected) return;
    try {
      const values = await rcaForm.validateFields();
      await post(`/api/badcases/${selected.id}/rca`, {
        ...values,
        fixActions: [{ action: values.fixAction, owner: values.owner, role: values.role, priority: "P1", verification: values.verification }],
      });
      message.success("RCA 已提交");
      setSelected(null);
      rcaForm.resetFields();
      loadBadcases();
    } catch (e) {
      message.error("提交失败：" + (e instanceof Error ? e.message : ""));
    }
  };

  const columns = [
    { title: "Trace ID", key: "traceId", width: 160, ellipsis: true, render: (_: unknown, r: BadcaseItem) => r.trace.traceId },
    { title: "输入", key: "input", ellipsis: true, render: (_: unknown, r: BadcaseItem) => displayInput(r.trace.input) },
    { title: "用例", dataIndex: ["trial", "caseId"], key: "caseId", width: 200, ellipsis: true, render: (v: string) => v ?? "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 120, render: (v: string) => <Tag color={["analyzed", "needs-fix", "closed"].includes(v) ? "green" : "orange"}>{v}</Tag> },
    { title: "问题簇", key: "cluster", width: 160, render: (_: unknown, r: BadcaseItem) => r.cluster ? `${r.cluster.rootCause} (${r.cluster.size})` : "-" },
    { title: "RCA", key: "rca", width: 100, render: (_: unknown, r: BadcaseItem) => r.rca ? <Tag color="green">已分析</Tag> : <Tag>待分析</Tag> },
    { title: "操作", key: "action", width: 80, render: (_: unknown, r: BadcaseItem) => <a onClick={() => setSelected(r)}>详情</a> },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Select
            value={agentId}
            onChange={setAgentId}
            style={{ width: 160 }}
            options={agents.map((a) => ({ label: a.name || a.id, value: a.id }))}
          />
          <Button icon={<SearchOutlined />} onClick={handleIdentify}>识别 + 聚类</Button>
          <Button icon={<ReloadOutlined />} onClick={loadBadcases}>刷新</Button>
        </Space>
      </Card>

      <Card title={<><BugOutlined /> Badcase 列表 ({badcases.length})</>}>
        <Table
          dataSource={badcases}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <Empty description="暂无 Badcase，请先跑测并点击「识别+聚类」" /> }}
        />
      </Card>

      <Drawer
        title="Badcase 详情 & RCA"
        open={!!selected}
        onClose={() => setSelected(null)}
        width={560}
      >
        {selected && (
          <>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Trace ID">{selected.trace.traceId}</Descriptions.Item>
              <Descriptions.Item label="输入">{displayInput(selected.trace.input)}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{selected.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="来源"><Tag>{selected.source}</Tag></Descriptions.Item>
              <Descriptions.Item label="用例 / Run">{selected.trial?.caseId ?? "-"} / {selected.trial?.runId ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="风险 / 场景">{selected.trial?.risk ?? "-"} / {selected.trial?.scenario ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="问题簇">{selected.cluster?.rootCause ?? "未聚类"}</Descriptions.Item>
            </Descriptions>

            {selected.rca ? (
              <Card title="RCA 记录" size="small">
                <Steps
                  direction="vertical"
                  size="small"
                  current={4}
                  items={[
                    { title: "证据汇总", description: selected.rca.problemCategory },
                    { title: "范围收敛", description: selected.rca.problemEnum },
                    { title: "分模块诊断", description: selected.rca.responsibleModule },
                    { title: "责任判定", description: selected.rca.report ?? "-" },
                    { title: "结构化落盘", description: selected.rca.fixActions.map((a) => a.action).join("; ") },
                  ]}
                />
              </Card>
            ) : (
              <Card title="录入 RCA（五步）" size="small">
                <Form form={rcaForm} layout="vertical" size="small">
                  <Form.Item name="responsibleModule" label="责任模块" rules={[{ required: true }]}>
                    <Input placeholder="如：tool-router / canvas-engine / prompt" />
                  </Form.Item>
                  <Form.Item name="problemCategory" label="问题分类" rules={[{ required: true }]}>
                    <Input placeholder="如：参数错误 / 工具选错 / 知识缺失" />
                  </Form.Item>
                  <Form.Item name="problemEnum" label="问题枚举" rules={[{ required: true }]}>
                    <Input placeholder="如：PARAM_MISSING / TOOL_NOT_FOUND" />
                  </Form.Item>
                  <Form.Item name="fixAction" label="修复动作">
                    <Input placeholder="描述修复方案" />
                  </Form.Item>
                  <Form.Item name="owner" label="负责人">
                    <Input placeholder="负责人" />
                  </Form.Item>
                  <Form.Item name="role" label="角色">
                    <Select options={[
                      { label: "运营可配置", value: "运营可配置" },
                      { label: "算法需优化", value: "算法需优化" },
                      { label: "工程需修复", value: "工程需修复" },
                      { label: "业务需定口径", value: "业务需定口径" },
                    ]} />
                  </Form.Item>
                  <Form.Item name="verification" label="验证方式">
                    <Input placeholder="如何验证修复成功" />
                  </Form.Item>
                  <Button type="primary" onClick={handleSubmitRca}>提交 RCA</Button>
                </Form>
              </Card>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}

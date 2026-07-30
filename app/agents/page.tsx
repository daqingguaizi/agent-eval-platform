"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Typography,
  message,
  Popconfirm,
  Descriptions,
} from "antd";
import { PlusOutlined, DeleteOutlined, EyeOutlined, ApiOutlined } from "@ant-design/icons";
import { AGENT_TYPE_OPTIONS } from "@/lib/agent-types";

const { Title } = Typography;

interface Agent {
  id: string;
  name: string;
  agentTypes: string[];
  standardPath: string;
  createdAt: string;
}

interface StandardFile {
  file: string;
}

const typeColorMap: Record<string, string> = {
  "knowledge-qa": "blue",
  "task-execution": "orange",
  "reasoning-decision": "purple",
  "multi-turn-guide": "cyan",
  creative: "green",
  "multi-agent": "red",
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [standards, setStandards] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<
    (Agent & { standard?: unknown }) | null
  >(null);
  const [form] = Form.useForm();

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const json = await res.json();
      if (json.code === 0) setAgents(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStandards = useCallback(async () => {
    const res = await fetch("/api/standards");
    const json = await res.json();
    if (json.code === 0) {
      setStandards(json.data.map((s: StandardFile) => s.file));
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadStandards();
  }, [loadAgents, loadStandards]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success("Agent 创建成功");
        setCreateOpen(false);
        form.resetFields();
        loadAgents();
      } else {
        message.error(json.msg);
      }
    } catch {
      // form validation error
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.code === 0) {
      message.success("已删除");
      loadAgents();
    } else {
      message.error(json.msg);
    }
  };

  const handleViewDetail = async (id: string) => {
    const res = await fetch(`/api/agents/${id}`);
    const json = await res.json();
    if (json.code === 0) {
      setDetailData(json.data);
      setDetailOpen(true);
    }
  };

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 120,
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Agent 类型",
      dataIndex: "agentTypes",
      key: "agentTypes",
      render: (types: string[]) => (
        <Space wrap>
          {types.map((t) => {
            const opt = AGENT_TYPE_OPTIONS.find((o) => o.value === t);
            return (
              <Tag key={t} color={typeColorMap[t] || "default"}>
                {opt?.label || t}
              </Tag>
            );
          })}
        </Space>
      ),
    },
    {
      title: "构建标准",
      dataIndex: "standardPath",
      key: "standardPath",
      render: (p: string) => <Tag>{p}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, record: Agent) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ApiOutlined />}
            onClick={() => router.push(`/connections?agentId=${record.id}`)}
          >
            接入配置
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
          Agent 声明管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          声明 Agent
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={agents}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: "暂无 Agent，点击右上角「声明 Agent」开始" }}
        />
      </Card>

      {/* 创建 Modal */}
      <Modal
        title="声明新 Agent（Part0 分类先行）"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        okText="创建"
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="id"
            label="Agent ID"
            rules={[
              { required: true, message: "请输入唯一 ID" },
              {
                pattern: /^[a-z0-9-]+$/,
                message: "仅限小写字母、数字和连字符",
              },
            ]}
          >
            <Input placeholder="如 echo" />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="如 Echo 画布助手" />
          </Form.Item>
          <Form.Item
            name="agentTypes"
            label="Agent 类型（可多选）"
            rules={[{ required: true, message: "请选择至少一个类型" }]}
            extra="方法论要求「分类先行」：不同类型套不同评测骨架和指标模板"
          >
            <Select
              mode="multiple"
              placeholder="选择 Agent 类型"
              options={AGENT_TYPE_OPTIONS.map((o) => ({
                value: o.value,
                label: `${o.label} — ${o.description}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="standardPath"
            label="构建标准文件"
            rules={[{ required: true, message: "请选择构建标准文件" }]}
            extra="指向 standards/ 目录下的 YAML 文件"
          >
            <Select
              placeholder="选择已有的构建标准"
              options={standards.map((s) => ({ value: s, label: s }))}
              notFoundContent="standards/ 目录下暂无 YAML 文件"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 Modal */}
      <Modal
        title={`Agent 详情 — ${detailData?.name || ""}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
      >
        {detailData && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detailData.id}</Descriptions.Item>
            <Descriptions.Item label="名称">
              {detailData.name}
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              <Space wrap>
                {detailData.agentTypes.map((t) => {
                  const opt = AGENT_TYPE_OPTIONS.find((o) => o.value === t);
                  return (
                    <Tag key={t} color={typeColorMap[t] || "default"}>
                      {opt?.label || t}
                    </Tag>
                  );
                })}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="构建标准文件">
              {detailData.standardPath}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(detailData.createdAt).toLocaleString("zh-CN")}
            </Descriptions.Item>
            {detailData.standard && (
              <Descriptions.Item label="标准内容（预览）">
                <pre
                  style={{
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: "auto",
                    background: "#f5f5f5",
                    padding: 12,
                    borderRadius: 4,
                    margin: 0,
                  }}
                >
                  {JSON.stringify(detailData.standard, null, 2)}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  List,
  Tag,
  Typography,
  Spin,
  Modal,
  Input,
  message,
  Button,
  Space,
  Descriptions,
} from "antd";
import { EditOutlined, EyeOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface StandardData {
  agent: string;
  agentTypes: string[];
  categories: Array<{ id: string; title: string; riskLevel: string }>;
  coverage: Record<string, unknown>;
  priorities: Record<string, unknown>;
  goldenTarget: Record<string, unknown>;
  [key: string]: unknown;
}

interface StandardItem {
  file: string;
  data: StandardData;
}

const riskColors: Record<string, string> = {
  high: "red",
  medium: "orange",
  low: "green",
};

export default function StandardsPage() {
  const [standards, setStandards] = useState<StandardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editFile, setEditFile] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewItem, setViewItem] = useState<StandardItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/standards");
      const json = await res.json();
      if (json.code === 0) setStandards(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleEdit = (item: StandardItem) => {
    setEditFile(item.file);
    setEditContent(JSON.stringify(item.data, null, 2));
    setEditOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(editContent);
      const res = await fetch(`/api/standards/${editFile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success("保存成功");
        setEditOpen(false);
        load();
      } else {
        message.error(json.msg);
      }
    } catch (e) {
      message.error("JSON 格式错误：" + (e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  };

  const handleView = (item: StandardItem) => {
    setViewItem(item);
    setViewOpen(true);
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Title level={3}>构建标准管理</Title>
      <Text type="secondary">
        构建标准定义了评测集「该怎么建」，存于 standards/ 目录，由 Agent 开发者维护
      </Text>

      <List
        style={{ marginTop: 16 }}
        grid={{ gutter: 16, column: 1 }}
        dataSource={standards}
        renderItem={(item) => (
          <List.Item>
            <Card
              title={
                <Space>
                  <Tag color="blue">{item.file}</Tag>
                  <Text strong>Agent: {item.data.agent}</Text>
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => handleView(item)}
                  >
                    详情
                  </Button>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(item)}
                  >
                    编辑
                  </Button>
                </Space>
              }
            >
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">类型：</Text>
                {item.data.agentTypes?.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">分类维度：</Text>
                {item.data.categories?.map((c) => (
                  <Tag key={c.id} color={riskColors[c.riskLevel] || "default"}>
                    {c.title} ({c.riskLevel})
                  </Tag>
                ))}
              </div>
              <div>
                <Text type="secondary">Golden 目标：</Text>
                <Text>
                  {(item.data.goldenTarget as { minCases?: number })?.minCases}–
                  {(item.data.goldenTarget as { maxCases?: number })?.maxCases} 条
                </Text>
              </div>
            </Card>
          </List.Item>
        )}
      />

      {/* 编辑 Modal */}
      <Modal
        title={`编辑构建标准 — ${editFile}`}
        open={editOpen}
        onOk={handleSave}
        onCancel={() => setEditOpen(false)}
        okText="保存到文件"
        confirmLoading={saving}
        width={800}
      >
        <TextArea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={24}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        <Text type="secondary" style={{ marginTop: 8, display: "block" }}>
          编辑 JSON 后保存，将写回 standards/{editFile}（YAML 格式）
        </Text>
      </Modal>

      {/* 详情 Modal */}
      <Modal
        title={`标准详情 — ${viewItem?.file}`}
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
        width={720}
      >
        {viewItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Agent">
              {viewItem.data.agent}
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              {viewItem.data.agentTypes?.join(", ")}
            </Descriptions.Item>
            <Descriptions.Item label="分类">
              {viewItem.data.categories?.map((c) => (
                <Tag
                  key={c.id}
                  color={riskColors[c.riskLevel]}
                  style={{ marginBottom: 4 }}
                >
                  {c.title} [{c.riskLevel}]
                </Tag>
              ))}
            </Descriptions.Item>
            <Descriptions.Item label="覆盖维度">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(viewItem.data.coverage, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="优先级门禁">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(viewItem.data.priorities, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="Golden 目标">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(viewItem.data.goldenTarget, null, 2)}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

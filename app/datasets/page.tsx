"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Spin,
  Select,
  Space,
  Button,
  Modal,
  Input,
  message,
  Drawer,
  Descriptions,
  Popconfirm,
} from "antd";
import {
  FilterOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface EvalCase {
  id: string;
  title: string;
  agent: string;
  category: string;
  caseKind: string;
  tags?: string[];
  priority: string;
  source: string;
  status: string;
  precondition?: unknown;
  input: unknown;
  expected: unknown;
  judge: unknown;
  [key: string]: unknown;
}

interface DatasetFile {
  file: string;
  caseCount: number;
  cases: EvalCase[];
}

const priorityColors: Record<string, string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
};

const statusColors: Record<string, string> = {
  active: "green",
  draft: "default",
  review: "orange",
  deprecated: "red",
};

const caseKindLabels: Record<string, string> = {
  trigger: "触发",
  "core-logic": "核心逻辑",
  "output-quality": "产物质量",
  exception: "异常容错",
};

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [allCases, setAllCases] = useState<EvalCase[]>([]);

  // 筛选
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const [filterPriority, setFilterPriority] = useState<string | undefined>();
  const [filterSource, setFilterSource] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [filterTag, setFilterTag] = useState<string | undefined>();

  // 详情 / 编辑
  const [detailCase, setDetailCase] = useState<EvalCase | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editCaseId, setEditCaseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 新增
  const [addOpen, setAddOpen] = useState(false);
  const [addContent, setAddContent] = useState("");

  const loadDatasets = useCallback(async () => {
    try {
      const res = await fetch("/api/datasets");
      const json = await res.json();
      if (json.code === 0) {
        setDatasets(json.data);
        if (json.data.length > 0 && !selectedFile) {
          setSelectedFile(json.data[0].file);
          setAllCases(json.data[0].cases);
          setCases(json.data[0].cases);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedFile]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  // 切换文件
  const handleFileSelect = (file: string) => {
    setSelectedFile(file);
    const ds = datasets.find((d) => d.file === file);
    const c = ds?.cases || [];
    setAllCases(c);
    setCases(c);
    resetFilters();
  };

  // 筛选
  useEffect(() => {
    let filtered = [...allCases];
    if (filterCategory)
      filtered = filtered.filter((c) => c.category === filterCategory);
    if (filterPriority)
      filtered = filtered.filter((c) => c.priority === filterPriority);
    if (filterSource)
      filtered = filtered.filter((c) => c.source === filterSource);
    if (filterStatus)
      filtered = filtered.filter((c) => c.status === filterStatus);
    if (filterTag)
      filtered = filtered.filter((c) => c.tags?.includes(filterTag));
    setCases(filtered);
  }, [allCases, filterCategory, filterPriority, filterSource, filterStatus, filterTag]);

  const resetFilters = () => {
    setFilterCategory(undefined);
    setFilterPriority(undefined);
    setFilterSource(undefined);
    setFilterStatus(undefined);
    setFilterTag(undefined);
  };

  // 提取所有唯一值
  const uniqueValues = (key: keyof EvalCase) =>
    [...new Set(allCases.map((c) => c[key] as string).filter(Boolean))];
  const allTags = [
    ...new Set(allCases.flatMap((c) => c.tags || [])),
  ];

  // 编辑
  const handleEdit = (record: EvalCase) => {
    setEditCaseId(record.id);
    setEditContent(JSON.stringify(record, null, 2));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedFile) return;
    try {
      setSaving(true);
      const parsed = JSON.parse(editContent);
      parsed.id = editCaseId; // 确保 id 不变
      const res = await fetch(`/api/datasets/${selectedFile}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success("保存成功");
        setEditOpen(false);
        loadDatasets();
      } else {
        message.error(json.msg);
      }
    } catch (e) {
      message.error("JSON 格式错误：" + (e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  };

  // 新增
  const handleAdd = async () => {
    if (!selectedFile) return;
    try {
      setSaving(true);
      const parsed = JSON.parse(addContent);
      const res = await fetch(`/api/datasets/${selectedFile}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success("新增成功");
        setAddOpen(false);
        setAddContent("");
        loadDatasets();
      } else {
        message.error(json.msg);
      }
    } catch (e) {
      message.error("JSON 格式错误：" + (e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (caseId: string) => {
    if (!selectedFile) return;
    const res = await fetch(
      `/api/datasets/${selectedFile}?caseId=${caseId}`,
      { method: "DELETE" }
    );
    const json = await res.json();
    if (json.code === 0) {
      message.success("已删除");
      loadDatasets();
    } else {
      message.error(json.msg);
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", key: "id", width: 240, ellipsis: true },
    { title: "标题", dataIndex: "title", key: "title", ellipsis: true },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: "类型",
      dataIndex: "caseKind",
      key: "caseKind",
      width: 100,
      render: (v: string) => <Tag>{caseKindLabels[v] || v}</Tag>,
    },
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 80,
      render: (v: string) => <Tag color={priorityColors[v]}>{v}</Tag>,
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag>,
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      width: 180,
      render: (tags: string[]) =>
        tags?.map((t) => (
          <Tag key={t} style={{ marginBottom: 2 }}>
            {t}
          </Tag>
        )),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, record: EvalCase) => (
        <Space>
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => setDetailCase(record)}
          >
            详情
          </Button>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

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
          评测集管理
        </Title>
        <Space>
          <Select
            value={selectedFile}
            onChange={handleFileSelect}
            style={{ width: 260 }}
            options={datasets.map((d) => ({
              value: d.file,
              label: `${d.file} (${d.caseCount} 条)`,
            }))}
            placeholder="选择评测集文件"
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
            disabled={!selectedFile}
          >
            新增用例
          </Button>
        </Space>
      </div>

      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <FilterOutlined />
          <Select
            allowClear
            placeholder="分类"
            value={filterCategory}
            onChange={setFilterCategory}
            style={{ width: 140 }}
            options={uniqueValues("category").map((v) => ({
              value: v,
              label: v,
            }))}
          />
          <Select
            allowClear
            placeholder="优先级"
            value={filterPriority}
            onChange={setFilterPriority}
            style={{ width: 100 }}
            options={["P0", "P1", "P2"].map((v) => ({ value: v, label: v }))}
          />
          <Select
            allowClear
            placeholder="来源"
            value={filterSource}
            onChange={setFilterSource}
            style={{ width: 120 }}
            options={uniqueValues("source").map((v) => ({
              value: v,
              label: v,
            }))}
          />
          <Select
            allowClear
            placeholder="状态"
            value={filterStatus}
            onChange={setFilterStatus}
            style={{ width: 120 }}
            options={["draft", "review", "active", "deprecated"].map((v) => ({
              value: v,
              label: v,
            }))}
          />
          <Select
            allowClear
            placeholder="标签"
            value={filterTag}
            onChange={setFilterTag}
            style={{ width: 140 }}
            options={allTags.map((v) => ({ value: v, label: v }))}
          />
          <Button size="small" onClick={resetFilters}>
            重置
          </Button>
          <Text type="secondary">
            {cases.length}/{allCases.length} 条
          </Text>
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={cases}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: "暂无用例" }}
        />
      </Card>

      {/* 详情 Drawer */}
      <Drawer
        title={`用例详情 — ${detailCase?.title || ""}`}
        open={!!detailCase}
        onClose={() => setDetailCase(null)}
        width={640}
      >
        {detailCase && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detailCase.id}</Descriptions.Item>
            <Descriptions.Item label="标题">
              {detailCase.title}
            </Descriptions.Item>
            <Descriptions.Item label="分类">
              {detailCase.category}
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              {caseKindLabels[detailCase.caseKind] || detailCase.caseKind}
            </Descriptions.Item>
            <Descriptions.Item label="优先级">
              <Tag color={priorityColors[detailCase.priority]}>
                {detailCase.priority}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="来源">
              {detailCase.source}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColors[detailCase.status]}>
                {detailCase.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="标签">
              {detailCase.tags?.map((t) => <Tag key={t}>{t}</Tag>)}
            </Descriptions.Item>
            <Descriptions.Item label="前置条件">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(detailCase.precondition, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="输入">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(detailCase.input, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="期望行为">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(detailCase.expected, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="评分策略">
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(detailCase.judge, null, 2)}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      {/* 编辑 Modal */}
      <Modal
        title={`编辑用例 — ${editCaseId}`}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="保存到文件"
        confirmLoading={saving}
        width={720}
      >
        <TextArea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={20}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Modal>

      {/* 新增 Modal */}
      <Modal
        title="新增评测用例"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => {
          setAddOpen(false);
          setAddContent("");
        }}
        okText="添加"
        confirmLoading={saving}
        width={720}
      >
        <Text type="secondary" style={{ marginBottom: 8, display: "block" }}>
          请输入完整的用例 JSON（需包含 id 字段），将追加到 {selectedFile}
        </Text>
        <TextArea
          value={addContent}
          onChange={(e) => setAddContent(e.target.value)}
          rows={20}
          style={{ fontFamily: "monospace", fontSize: 12 }}
          placeholder='{"id": "echo-xxx-001", "title": "...", "agent": "echo", ...}'
        />
      </Modal>
    </div>
  );
}

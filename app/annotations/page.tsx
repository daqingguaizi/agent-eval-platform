"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Spin,
  Button,
  Space,
  Select,
  Modal,
  Form,
  Input,
  Radio,
  message,
  Tooltip,
  Badge,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  EyeOutlined,
  AuditOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface AnnotationData {
  id: string;
  traceRecordId: string;
  targetLevel: string;
  scorerType: string;
  verdict: string;
  problemCategory: string | null;
  phenomenon: string | null;
  confidence: number | null;
  reason: string | null;
  needsHumanReview: boolean;
  spotChecked: boolean;
  humanOverride: { verdict: string; reason: string } | null;
  createdAt: string;
  trace: {
    traceId: string;
    agentId: string;
    sessionId: string;
    input: { message: string };
  };
}

const verdictConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  pass: { color: "success", icon: <CheckCircleOutlined /> },
  soft_pass: { color: "warning", icon: <ExclamationCircleOutlined /> },
  fail: { color: "error", icon: <CloseCircleOutlined /> },
};

const scorerColors: Record<string, string> = {
  rule: "blue",
  llm: "purple",
  human: "orange",
};

const levelColors: Record<string, string> = {
  turn: "cyan",
  session: "geekblue",
  trace: "magenta",
  outcome: "green",
};

export default function AnnotationsPage() {
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // 筛选
  const [filterScorer, setFilterScorer] = useState<string | undefined>();
  const [filterVerdict, setFilterVerdict] = useState<string | undefined>();
  const [filterLevel, setFilterLevel] = useState<string | undefined>();
  const [filterNeedsReview, setFilterNeedsReview] = useState<string | undefined>();
  const [filterSpotChecked, setFilterSpotChecked] = useState<string | undefined>();

  // 人工抽查 Modal
  const [spotCheckOpen, setSpotCheckOpen] = useState(false);
  const [spotCheckTarget, setSpotCheckTarget] = useState<AnnotationData | null>(null);
  const [spotForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const loadAnnotations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "30" });
      if (filterScorer) params.set("scorerType", filterScorer);
      if (filterVerdict) params.set("verdict", filterVerdict);
      if (filterLevel) params.set("targetLevel", filterLevel);
      if (filterNeedsReview) params.set("needsHumanReview", filterNeedsReview);
      if (filterSpotChecked) params.set("spotChecked", filterSpotChecked);

      const res = await fetch(`/api/annotations?${params}`);
      const json = await res.json();
      if (json.code === 0) {
        setAnnotations(json.data.annotations);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, filterScorer, filterVerdict, filterLevel, filterNeedsReview, filterSpotChecked]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // 人工抽查
  const openSpotCheck = (record: AnnotationData) => {
    setSpotCheckTarget(record);
    spotForm.setFieldsValue({
      verdict: record.humanOverride?.verdict ?? record.verdict,
      reason: record.humanOverride?.reason ?? "",
    });
    setSpotCheckOpen(true);
  };

  const handleSpotCheck = async () => {
    if (!spotCheckTarget) return;
    try {
      setSubmitting(true);
      const values = await spotForm.validateFields();
      const res = await fetch(`/api/annotations/${spotCheckTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotChecked: true,
          humanOverride: {
            verdict: values.verdict,
            reason: values.reason,
          },
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success("人工抽查结果已保存");
        setSpotCheckOpen(false);
        loadAnnotations();
      } else {
        message.error(json.msg);
      }
    } catch {
      // validation error
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: "标注结论",
      key: "verdict",
      width: 140,
      render: (_: unknown, r: AnnotationData) => {
        // 如果有人工覆盖，显示覆盖结论
        const effective = r.humanOverride ?? { verdict: r.verdict, reason: r.reason };
        const cfg = verdictConfig[effective.verdict] ?? verdictConfig.fail;
        return (
          <Space>
            <Tag icon={cfg.icon} color={cfg.color}>
              {effective.verdict}
            </Tag>
            {r.humanOverride && (
              <Tooltip title="已被人工覆盖">
                <Badge status="warning" />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: "Scorer",
      dataIndex: "scorerType",
      key: "scorerType",
      width: 80,
      render: (v: string) => <Tag color={scorerColors[v]}>{v}</Tag>,
    },
    {
      title: "层次",
      dataIndex: "targetLevel",
      key: "targetLevel",
      width: 80,
      render: (v: string) => <Tag color={levelColors[v]}>{v}</Tag>,
    },
    {
      title: "输入（关联 Trace）",
      key: "input",
      ellipsis: true,
      render: (_: unknown, r: AnnotationData) => (
        <Tooltip title={r.trace?.traceId}>
          <Text ellipsis style={{ maxWidth: 240 }}>
            {r.trace?.input?.message}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: "问题分类",
      dataIndex: "problemCategory",
      key: "problemCategory",
      width: 120,
      render: (v: string | null) => v ? <Tag>{v}</Tag> : "-",
    },
    {
      title: "置信度",
      dataIndex: "confidence",
      key: "confidence",
      width: 80,
      render: (v: number | null) =>
        v !== null ? (
          <Text type={v < 0.7 ? "danger" : v < 0.85 ? "warning" : undefined}>
            {(v * 100).toFixed(0)}%
          </Text>
        ) : (
          "-"
        ),
    },
    {
      title: "判定依据",
      dataIndex: "reason",
      key: "reason",
      width: 200,
      ellipsis: true,
      render: (v: string | null, r: AnnotationData) => (
        <Tooltip title={r.humanOverride?.reason ?? v}>
          <Text ellipsis style={{ maxWidth: 200 }}>
            {r.humanOverride?.reason ?? v ?? "-"}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_: unknown, r: AnnotationData) => (
        <Space direction="vertical" size={0}>
          {r.needsHumanReview && <Tag color="red">待人工</Tag>}
          {r.spotChecked && <Tag color="gold">已抽查</Tag>}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: unknown, r: AnnotationData) => (
        <Button
          size="small"
          type="link"
          icon={<AuditOutlined />}
          onClick={() => openSpotCheck(r)}
        >
          抽查
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={3}>标注管理</Title>

      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <EyeOutlined />
          <Select
            allowClear
            placeholder="Scorer 类型"
            value={filterScorer}
            onChange={(v) => { setFilterScorer(v); setPage(1); }}
            style={{ width: 120 }}
            options={[
              { value: "rule", label: "规则" },
              { value: "llm", label: "LLM" },
              { value: "human", label: "人工" },
            ]}
          />
          <Select
            allowClear
            placeholder="结论"
            value={filterVerdict}
            onChange={(v) => { setFilterVerdict(v); setPage(1); }}
            style={{ width: 120 }}
            options={[
              { value: "pass", label: "pass" },
              { value: "soft_pass", label: "soft_pass" },
              { value: "fail", label: "fail" },
            ]}
          />
          <Select
            allowClear
            placeholder="层次"
            value={filterLevel}
            onChange={(v) => { setFilterLevel(v); setPage(1); }}
            style={{ width: 120 }}
            options={[
              { value: "turn", label: "Turn" },
              { value: "session", label: "Session" },
              { value: "trace", label: "Trace" },
              { value: "outcome", label: "Outcome" },
            ]}
          />
          <Select
            allowClear
            placeholder="待人工"
            value={filterNeedsReview}
            onChange={(v) => { setFilterNeedsReview(v); setPage(1); }}
            style={{ width: 100 }}
            options={[
              { value: "true", label: "是" },
              { value: "false", label: "否" },
            ]}
          />
          <Select
            allowClear
            placeholder="已抽查"
            value={filterSpotChecked}
            onChange={(v) => { setFilterSpotChecked(v); setPage(1); }}
            style={{ width: 100 }}
            options={[
              { value: "true", label: "是" },
              { value: "false", label: "否" },
            ]}
          />
          <Text type="secondary">共 {total} 条</Text>
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={annotations}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 30,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条`,
          }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: "暂无标注数据" }}
        />
      </Card>

      {/* 人工抽查 Modal */}
      <Modal
        title="人工抽查（Spot-check）"
        open={spotCheckOpen}
        onOk={handleSpotCheck}
        onCancel={() => setSpotCheckOpen(false)}
        okText="保存抽查结果"
        confirmLoading={submitting}
        width={560}
      >
        {spotCheckTarget && (
          <>
            <Card size="small" style={{ marginBottom: 16, background: "#fafafa" }}>
              <Space direction="vertical" size={4}>
                <Text type="secondary">
                  关联输入：{spotCheckTarget.trace?.input?.message}
                </Text>
                <Space>
                  <Text type="secondary">原始结论：</Text>
                  <Tag
                    color={verdictConfig[spotCheckTarget.verdict]?.color}
                    icon={verdictConfig[spotCheckTarget.verdict]?.icon}
                  >
                    {spotCheckTarget.verdict}
                  </Tag>
                  <Tag color={scorerColors[spotCheckTarget.scorerType]}>
                    {spotCheckTarget.scorerType}
                  </Tag>
                </Space>
                {spotCheckTarget.reason && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    原始依据：{spotCheckTarget.reason}
                  </Text>
                )}
              </Space>
            </Card>

            <Form form={spotForm} layout="vertical">
              <Form.Item
                name="verdict"
                label="人工判定结论"
                rules={[{ required: true }]}
              >
                <Radio.Group>
                  <Radio.Button value="pass">
                    <CheckCircleOutlined /> Pass
                  </Radio.Button>
                  <Radio.Button value="soft_pass">
                    <ExclamationCircleOutlined /> Soft Pass
                  </Radio.Button>
                  <Radio.Button value="fail">
                    <CloseCircleOutlined /> Fail
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                name="reason"
                label="人工判定依据"
                rules={[{ required: true, message: "请填写判定依据" }]}
              >
                <TextArea
                  rows={4}
                  placeholder="请说明人工判定的理由（便于后续校准规则/Judge）"
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}

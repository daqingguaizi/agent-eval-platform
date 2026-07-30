"use client";

import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Tag, Typography, Spin, Alert, Table, Progress, Space, Button } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  BugOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

const { Title, Paragraph } = Typography;

interface HealthData { db: string; agentCount: number }
interface RunItem {
  id: string;
  agentId: string;
  status: string;
  gatePassed: boolean | null;
  createdAt: string;
  summary: { totalCases?: number; pass?: number; fail?: number; passRate?: number } | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standardCount, setStandardCount] = useState(0);
  const [datasetCount, setDatasetCount] = useState(0);
  const [caseCount, setCaseCount] = useState(0);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [badcaseCount, setBadcaseCount] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, stdRes, dsRes, runsRes, bcRes] = await Promise.all([
          fetch("/api/health").then((r) => r.json()),
          fetch("/api/standards").then((r) => r.json()),
          fetch("/api/datasets").then((r) => r.json()),
          fetch("/api/runs").then((r) => r.json()),
          fetch("/api/badcases").then((r) => r.json()).catch(() => ({ code: 0, data: [] })),
        ]);

        if (healthRes.code === 0) setHealth(healthRes.data);
        else setError(healthRes.msg);

        if (stdRes.code === 0) setStandardCount(stdRes.data?.length ?? 0);
        if (dsRes.code === 0) {
          const files = dsRes.data ?? [];
          setDatasetCount(files.length);
          setCaseCount(files.reduce((s: number, d: { caseCount?: number }) => s + (d.caseCount ?? 0), 0));
        }
        if (runsRes.code === 0) setRuns((runsRes.data ?? []).slice(0, 5));
        if (bcRes.code === 0) setBadcaseCount((bcRes.data ?? []).length);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>;
  }

  const lastRun = runs[0];
  const gateStatus = lastRun?.gatePassed;

  return (
    <div>
      <Title level={3}>仪表盘</Title>
      <Paragraph type="secondary">
        Agent 评测平台 — 全流程评测：跑测 → 报告门禁 → Badcase/RCA → Loop 闭环
      </Paragraph>

      {error && <Alert message="连接异常" description={error} type="error" showIcon style={{ marginBottom: 16 }} />}

      {/* 核心指标卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card>
            <Statistic title="数据库" value={health?.db === "connected" ? "已连接" : "未连接"} prefix={<CheckCircleOutlined />} valueStyle={{ color: health?.db === "connected" ? "#52c41a" : "#ff4d4f" }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Agent 数" value={health?.agentCount ?? 0} prefix={<ExperimentOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="构建标准" value={standardCount} suffix="份" prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="评测用例" value={caseCount} suffix="条" prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="跑测次数" value={runs.length} prefix={<PlayCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="Badcase" value={badcaseCount} prefix={<BugOutlined />} valueStyle={{ color: badcaseCount > 0 ? "#faad14" : undefined }} />
          </Card>
        </Col>
      </Row>

      {/* 最近门禁状态 */}
      {lastRun && (
        <Card
          style={{ marginBottom: 16 }}
          title={<><BarChartOutlined /> 最近跑测门禁</>}
          extra={<Button type="link" onClick={() => router.push("/reports")}>查看报告 →</Button>}
        >
          <Space size="large">
            {gateStatus !== null && (
              gateStatus
                ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ fontSize: 16, padding: "4px 12px" }}>PASS</Tag>
                : <Tag icon={<CloseCircleOutlined />} color="error" style={{ fontSize: 16, padding: "4px 12px" }}>FAIL</Tag>
            )}
            <Statistic title="通过率" value={`${Math.round((lastRun.summary?.passRate ?? 0) * 100)}%`} />
            <Statistic title="通过" value={lastRun.summary?.pass ?? 0} valueStyle={{ color: "#52c41a" }} />
            <Statistic title="失败" value={lastRun.summary?.fail ?? 0} valueStyle={{ color: "#f5222d" }} />
          </Space>
        </Card>
      )}

      {/* 最近跑测列表 */}
      <Card title="最近跑测" extra={<Button type="link" onClick={() => router.push("/runs")}>全部 →</Button>}>
        <Table
          dataSource={runs}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: "暂无跑测记录，前往「跑测」页面开始" }}
          columns={[
            { title: "Run ID", dataIndex: "id", key: "id", width: 160, ellipsis: true },
            { title: "Agent", dataIndex: "agentId", key: "agentId", width: 100 },
            { title: "门禁", dataIndex: "gatePassed", key: "gate", width: 80, render: (v: boolean | null) => v === null ? "-" : v ? <Tag color="green">PASS</Tag> : <Tag color="red">FAIL</Tag> },
            { title: "通过率", key: "pr", width: 120, render: (_: unknown, r: RunItem) => r.summary ? <Progress percent={Math.round((r.summary.passRate ?? 0) * 100)} size="small" /> : "-" },
            { title: "时间", dataIndex: "createdAt", key: "time", width: 180, render: (v: string) => new Date(v).toLocaleString("zh-CN") },
          ]}
        />
      </Card>
    </div>
  );
}

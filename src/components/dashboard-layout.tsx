"use client";

import React from "react";
import { Layout, Menu } from "antd";
import {
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  RobotOutlined,
  TagsOutlined,
  PlayCircleOutlined,
  BarChartOutlined,
  BugOutlined,
  SyncOutlined,
  CloudDownloadOutlined,
  SettingOutlined,
  ApiOutlined,
  AuditOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";

const { Sider, Content, Header } = Layout;

const menuItems = [
  { key: "/", icon: <DashboardOutlined />, label: "仪表盘" },
  { key: "/agents", icon: <RobotOutlined />, label: "Agent 声明" },
  { key: "/connections", icon: <ApiOutlined />, label: "Agent 接入" },
  { key: "/datasets", icon: <DatabaseOutlined />, label: "评测集" },
  { key: "/standards", icon: <FileTextOutlined />, label: "构建标准" },
  { key: "/traces", icon: <ExperimentOutlined />, label: "Trace 显化" },
  { key: "/annotations", icon: <TagsOutlined />, label: "标注" },
  { key: "/reviews", icon: <AuditOutlined />, label: "人工审核" },
  { type: "divider" as const },
  { key: "/runs", icon: <PlayCircleOutlined />, label: "跑测" },
  { key: "/reports", icon: <BarChartOutlined />, label: "报告看板" },
  { key: "/badcases", icon: <BugOutlined />, label: "Badcase & RCA" },
  { key: "/loops", icon: <SyncOutlined />, label: "Loop 运营" },
  { key: "/skillopt", icon: <ExperimentOutlined />, label: "SkillOpt" },
  { key: "/production", icon: <CloudDownloadOutlined />, label: "线上采集" },
  { type: "divider" as const },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={220} style={{ borderRight: "1px solid #f0f0f0" }}>
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 16,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          Agent 评测平台
        </div>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            fontSize: 14,
            color: "#666",
          }}
        >
          Agent 评测平台 v1.0 — 全流程评测：跑测 → 报告门禁 → Badcase/RCA → Loop
        </Header>
        <Content style={{ padding: 24, background: "#f5f5f5", minHeight: 360 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}

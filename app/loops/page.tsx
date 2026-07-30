"use client";

import React, { useState, useEffect } from "react";
import {
  Card, Button, Select, Space, Tag, Timeline, message, Descriptions, Empty, Alert,
} from "antd";
import { SyncOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { get, post } from "@/lib/http";

interface AgentItem { id: string; name: string }

interface TriageItem {
  clusterId: string;
  rootCause: string;
  size: number;
  decision: "needs-fix" | "observe" | "close";
  reason: string;
}

interface LoopResult {
  triage?: TriageItem[];
  specs?: string[];
  verification?: { verified: boolean; passCount: number; failCount: number };
}

const decisionColor: Record<string, string> = {
  "needs-fix": "red",
  observe: "orange",
  close: "default",
};

export default function LoopsPage() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [history, setHistory] = useState<LoopResult[]>([]);

  useEffect(() => {
    get<AgentItem[]>("/api/agents").then((data) => {
      setAgents(data ?? []);
      if (data?.length) setAgentId(data[0].id);
    });
  }, []);

  const runVerification = async () => {
    const clusterId = window.prompt("输入问题簇 ID");
    const validationRunId = window.prompt("输入已完成的 Validation Run ID");
    if (!clusterId || !validationRunId || !agentId) return;
    setLoading(true);
    try {
      const data = await post<LoopResult>("/api/loops/run", { agentId, actions: ["verify"], clusterId, validationRunId });
      setResult(data);
      message.success("验证结果已关联到问题簇");
    } catch (e) {
      message.error("验证失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  const runLoop = async (actions: string[]) => {
    if (!agentId) { message.warning("请选择 Agent"); return; }
    setLoading(true);
    try {
      const data = await post<LoopResult>("/api/loops/run", { agentId, actions });
      setResult(data);
      setHistory((h) => [data, ...h]);
      message.success("Loop 执行完成");
    } catch (e) {
      message.error("执行失败：" + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            value={agentId}
            onChange={setAgentId}
            style={{ width: 160 }}
            options={agents.map((a) => ({ label: a.name || a.id, value: a.id }))}
          />
          <Button icon={<ThunderboltOutlined />} onClick={() => runLoop(["triage"])} loading={loading}>
            分诊
          </Button>
          <Button onClick={() => runLoop(["triage", "spec"])} loading={loading}>
            分诊 + 生成 Spec
          </Button>
          <Button onClick={() => void runVerification()} loading={loading}>
            验证修复
          </Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={() => runLoop(["triage", "spec", "verify"])} loading={loading}>
            完整一轮
          </Button>
        </Space>
      </Card>

      {result ? (
        <Card title="最新 Loop 结果">
          {result.triage && result.triage.length > 0 && (
            <Card type="inner" title="分诊结论" style={{ marginBottom: 16 }}>
              <Timeline
                items={result.triage.map((t) => ({
                  color: t.decision === "needs-fix" ? "red" : t.decision === "observe" ? "orange" : "gray",
                  children: (
                    <div>
                      <Tag color={decisionColor[t.decision]}>{t.decision}</Tag>
                      <strong>{t.rootCause}</strong>（规模 {t.size}）
                      <div style={{ color: "#999", fontSize: 12 }}>{t.reason}</div>
                    </div>
                  ),
                }))}
              />
            </Card>
          )}

          {result.specs && result.specs.length > 0 && (
            <Card type="inner" title="生成的 Spec" style={{ marginBottom: 16 }}>
              {result.specs.map((s, i) => (
                <Tag key={i} color="blue">{s}</Tag>
              ))}
            </Card>
          )}

          {result.verification && (
            <Alert
              type={result.verification.verified ? "success" : "warning"}
              message={result.verification.verified ? "验证通过" : "验证未通过"}
              description={`通过 ${result.verification.passCount}，失败 ${result.verification.failCount}`}
            />
          )}
        </Card>
      ) : (
        <Card>
          <Empty description="点击上方按钮执行 Loop 运营" />
        </Card>
      )}
    </div>
  );
}

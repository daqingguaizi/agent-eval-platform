"use client";

import { useEffect, useState } from "react";
import { Button, Card, Drawer, Form, Input, Select, Table, Tag, Typography, message } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { get, request } from "@/lib/http";

interface Task { id: string; reason: string; status: string; proposedVerdict?: string; trial?: { caseId: string; risk: string; runId: string }; annotation?: { reason?: string; trace: { traceId: string; input: { message: string }; outcome: { finalText: string } } } }
export default function ReviewsPage() {
  const [tasks, setTasks] = useState<Task[]>([]); const [selected, setSelected] = useState<Task>(); const [form] = Form.useForm();
  const load = async () => setTasks(await get<Task[]>("/api/reviews?status=pending")); useEffect(() => { void load(); }, []);
  const resolve = async () => { if (!selected) return; const values = await form.validateFields(); await request(`/api/reviews/${selected.id}`, { method: "PATCH", body: JSON.stringify(values) }); message.success("人工终判已保存"); setSelected(undefined); form.resetFields(); void load(); };
  return <div><Typography.Title level={3}>人工审核队列</Typography.Title><Card><Table rowKey="id" dataSource={tasks} pagination={{ pageSize: 20 }} columns={[{ title: "风险", key: "risk", render: (_: unknown, row: Task) => <Tag color={row.trial?.risk === "P0" ? "red" : "orange"}>{row.trial?.risk ?? "-"}</Tag> }, { title: "Case", key: "case", render: (_: unknown, row: Task) => row.trial?.caseId ?? "-" }, { title: "原因", dataIndex: "reason" }, { title: "建议结论", dataIndex: "proposedVerdict" }, { title: "操作", render: (_: unknown, row: Task) => <Button type="link" onClick={() => setSelected(row)}>审核</Button> }]} /></Card>
    <Drawer open={Boolean(selected)} onClose={() => setSelected(undefined)} title="人工终判" width={560}>{selected && <><p><Tag>{selected.trial?.risk}</Tag>{selected.reason}</p><Card size="small" title="评测证据"><p><b>输入：</b>{selected.annotation?.trace.input.message}</p><p><b>输出：</b>{selected.annotation?.trace.outcome.finalText}</p><p><b>自动结论：</b>{selected.annotation?.reason}</p></Card><Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ verdict: selected.proposedVerdict }}><Form.Item name="verdict" label="最终结论" rules={[{ required: true }]}><Select options={["pass", "soft_pass", "fail"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="evidence" label="判定证据" rules={[{ required: true, message: "请记录人工判定证据" }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="reviewerId" label="审核人"><Input /></Form.Item><Button type="primary" icon={<CheckOutlined />} onClick={() => void resolve()}>提交终判</Button></Form></>}</Drawer>
  </div>;
}

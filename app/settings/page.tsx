"use client";

import { useEffect, useState } from "react";
import localforage from "localforage";
import { Alert, Button, Card, Form, Input, Space, Tag, Typography, message } from "antd";
import { CheckCircleOutlined, SettingOutlined } from "@ant-design/icons";

interface LlmConfig { apiKey: string; baseUrl: string; model: string }
const store = localforage.createInstance({ name: "agent-eval-platform", storeName: "settings" });
const key = "llm-judge-config";

export default function SettingsPage() {
  const [form] = Form.useForm<LlmConfig>(); const [testing, setTesting] = useState(false); const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  useEffect(() => { store.getItem<LlmConfig>(key).then((value) => form.setFieldsValue(value ?? { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" })); }, [form]);
  const save = async () => { await store.setItem(key, form.getFieldsValue()); message.success("浏览器本地配置已保存，不会写入服务端数据库"); };
  const test = async () => { const value = form.getFieldsValue(); if (!value.apiKey) { message.warning("请填写 API Key"); return; } setTesting(true); try { const response = await fetch(`${value.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${value.apiKey}` } }); setStatus(response.ok ? "ok" : "error"); response.ok ? message.success("连通性检测通过") : message.error(`检测失败：HTTP ${response.status}`); } catch (error) { setStatus("error"); message.error(error instanceof Error ? error.message : "网络错误"); } finally { setTesting(false); } };
  return <div style={{ maxWidth: 720 }}><Typography.Title level={3}><SettingOutlined /> LLM Judge 配置</Typography.Title><Alert type="warning" showIcon style={{ marginBottom: 16 }} message="后台 Worker 的真实 Run 只能使用服务端 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL。此处配置仅保存于当前浏览器，适用于前端连通性自检，不会记录到 Run、Trace 或数据库。" /><Card><Form form={form} layout="vertical"><Form.Item name="apiKey" label="API Key"><Input.Password /></Form.Item><Form.Item name="baseUrl" label="Base URL"><Input /></Form.Item><Form.Item name="model" label="Model"><Input /></Form.Item><Space><Button type="primary" onClick={() => void save()}>本地保存</Button><Button loading={testing} onClick={() => void test()}>连通性检测</Button>{status === "ok" && <Tag color="green" icon={<CheckCircleOutlined />}>已连通</Tag>}</Space></Form></Card></div>;
}

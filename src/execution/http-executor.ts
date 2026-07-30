import { createHmac } from "node:crypto";
import type { AgentConnectionConfig, AgentExecutor, ExecutionRequest, ExecutionStartResult } from "@/types";

function getSecret(envRef?: string): string | undefined {
  return envRef ? process.env[envRef] : undefined;
}

export class HttpExecutor implements AgentExecutor {
  protocol = "http" as const;

  async execute(connection: AgentConnectionConfig, request: ExecutionRequest): Promise<ExecutionStartResult> {
    if (!connection.endpoint) throw new Error("HTTP 执行器缺少 endpoint");
    const body = JSON.stringify(request);
    const timestamp = String(Date.now());
    const secret = getSecret(connection.secretEnvRef);
    const headers: Record<string, string> = { "content-type": "application/json", "x-eval-timestamp": timestamp };
    if (secret) headers["x-eval-signature"] = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const response = await fetch(connection.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(connection.timeoutMs) });
    if (!response.ok) throw new Error(`Agent HTTP 执行失败：${response.status} ${await response.text()}`);
    const payload = await response.json() as { status?: string; envelope?: ExecutionStartResult["envelope"]; sessionId?: string };
    if (payload.status === "awaiting_callback") return { status: "awaiting_callback", sessionId: payload.sessionId };
    if (!payload.envelope) throw new Error("Agent 响应缺少版本化 Trace envelope");
    return { status: "completed", envelope: payload.envelope };
  }
}

import type { AgentConnectionConfig, AgentExecutor, ExecutionRequest, ExecutionStartResult } from "@/types";

export class CallbackExecutor implements AgentExecutor {
  protocol = "callback" as const;

  async execute(connection: AgentConnectionConfig, request: ExecutionRequest): Promise<ExecutionStartResult> {
    if (!connection.endpoint) throw new Error("Bridge 执行器缺少 endpoint");
    const response = await fetch(connection.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, callbackPath: connection.callbackPath ?? "/api/executions/callback" }),
      signal: AbortSignal.timeout(connection.timeoutMs),
    });
    if (!response.ok) throw new Error(`Bridge 任务创建失败：${response.status} ${await response.text()}`);
    const payload = await response.json() as { sessionId?: string };
    return { status: "awaiting_callback", sessionId: payload.sessionId };
  }
}

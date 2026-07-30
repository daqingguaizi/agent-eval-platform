import type { EvalCase, IsolationCapabilities } from "@/types";

const WRITE_TOOL_PREFIXES = ["canvas_create_", "canvas_update_", "canvas_delete_", "canvas_move_", "canvas_connect_"];

export function caseWritesState(evalCase: EvalCase): boolean {
  const tools = Array.isArray(evalCase.expected.toolCalls) ? evalCase.expected.toolCalls : [];
  return tools.some((item) => {
    const tool = (item as { tool?: unknown }).tool;
    return typeof tool === "string" && WRITE_TOOL_PREFIXES.some((prefix) => tool.startsWith(prefix));
  });
}

export function validateIsolation(evalCase: EvalCase, capabilities: IsolationCapabilities): string | null {
  if (!caseWritesState(evalCase)) return null;
  const cleanup = typeof evalCase.precondition?.cleanup === "string";
  const supportedIsolation = capabilities.sandbox || capabilities.rollback || capabilities.testAccount;
  if (!supportedIsolation) return "连接未声明 Sandbox、回滚或专用测试账号，禁止执行写操作用例";
  if (!capabilities.cleanupCallback || !cleanup) return "写操作用例必须声明 cleanup 且连接必须支持清理回调";
  return null;
}

export function createIsolationNamespace(runId: string, trialId: string): string {
  return `eval-${runId}-${trialId}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 120);
}

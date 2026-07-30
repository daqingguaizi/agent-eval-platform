import type { AgentExecutor, ExecutionProtocol } from "@/types";
import { CallbackExecutor } from "./callback-executor";
import { HttpExecutor } from "./http-executor";

const executors = new Map<ExecutionProtocol, AgentExecutor>([
  ["http", new HttpExecutor()],
  ["callback", new CallbackExecutor()],
]);

export function getExecutor(protocol: ExecutionProtocol): AgentExecutor | undefined {
  return executors.get(protocol);
}

export function registerExecutor(executor: AgentExecutor) {
  executors.set(executor.protocol, executor);
}

/**
 * 多 Agent Adapter 泛化框架
 *
 * 新接入一个 Agent 只需：
 * 1. 在 src/adapters/ 下新建文件实现 TraceAdapter 接口
 * 2. 在本文件注册
 * 3. 在 standards/ 下创建构建标准
 * 4. 通过 /api/agents 声明 Agent 类型
 *
 * 全部 Scorer/RCA/Loop/显化能力自动复用，无需为新 Agent 写定制代码
 */
import type { TraceAdapter } from "@/types";
import { echoAdapter } from "./echo";

// ── 注册表 ──

const registry = new Map<string, TraceAdapter<unknown>>();

// Echo（已实现）
registry.set("echo", echoAdapter as TraceAdapter<unknown>);

// ── 泛化 API ──

export function getAdapter(agentId: string): TraceAdapter<unknown> | undefined {
  return registry.get(agentId);
}

export function listAdapters(): string[] {
  return [...registry.keys()];
}

export function registerAdapter(agentId: string, adapter: TraceAdapter<unknown>) {
  registry.set(agentId, adapter);
}

/**
 * 示例：如何接入新 Agent
 *
 * ```ts
 * // src/adapters/my-agent.ts
 * import type { TraceAdapter } from "@/types";
 * import type { NormalizedTrace } from "@/types/normalized-trace";
 *
 * interface MyAgentRaw { ... }
 *
 * export class MyAgentAdapter implements TraceAdapter<MyAgentRaw> {
 *   agentType = "task-execution";
 *   agentId = "my-agent";
 *
 *   toNormalizedTrace(raw: MyAgentRaw): NormalizedTrace {
 *     return {
 *       traceId: raw.id,
 *       sessionId: raw.sessionId,
 *       turnId: raw.turnId,
 *       agentType: this.agentType,
 *       agentId: this.agentId,
 *       source: "pre-release",
 *       input: { type: "text", message: raw.userMessage },
 *       spans: raw.steps.map(s => ({
 *         spanId: s.id,
 *         kind: s.type as "llm" | "tool",
 *         name: s.name,
 *         input: s.params,
 *         output: s.result,
 *         startTime: s.timestamp,
 *       })),
 *       outcome: { finalText: raw.finalResponse },
 *       startTime: raw.timestamp,
 *     };
 *   }
 * }
 *
 * // 然后在 src/adapters/index.ts 注册：
 * // import { myAgentAdapter } from "./my-agent";
 * // registerAdapter("my-agent", myAgentAdapter);
 * ```
 */

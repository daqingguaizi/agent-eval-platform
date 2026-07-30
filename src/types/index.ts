export * from "./eval-case";
export * from "./execution";
export * from "./normalized-trace";
export * from "./scoring";

import type { NormalizedTrace } from "./normalized-trace";

export interface TraceAdapter<Raw = unknown> {
  agentType: string;
  agentId: string;
  toNormalizedTrace(raw: Raw): NormalizedTrace;
}

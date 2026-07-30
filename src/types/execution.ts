import type { EvalCase } from "./eval-case";

export const EXECUTION_PROTOCOLS = ["http", "callback", "simulate"] as const;
export type ExecutionProtocol = (typeof EXECUTION_PROTOCOLS)[number];

export interface IsolationCapabilities {
  sandbox: boolean;
  rollback: boolean;
  testAccount: boolean;
  cleanupCallback: boolean;
  supportsWriteOperations: boolean;
}

export interface AgentConnectionConfig {
  id: string;
  agentId: string;
  protocol: ExecutionProtocol;
  endpoint?: string;
  callbackPath?: string;
  secretEnvRef?: string;
  timeoutMs: number;
  capabilities: IsolationCapabilities;
}

export interface ExecutionRequest {
  protocolVersion: "v1";
  runId: string;
  trialId: string;
  caseId: string;
  agentId: string;
  evalCase: EvalCase;
  fixtureRefs: string[];
  isolation: {
    namespace: string;
    requireCleanup: boolean;
    writeOperation: boolean;
  };
  timeoutMs: number;
}

export interface ExecutionEnvelope {
  protocolVersion: "v1";
  eventKey: string;
  runId: string;
  trialId: string;
  caseId: string;
  agentId: string;
  rawTrace: unknown;
  cleanup?: { status: "completed" | "failed" | "not_required"; message?: string };
  timestamp: number;
}

export interface ExecutionStartResult {
  status: "completed" | "awaiting_callback";
  envelope?: ExecutionEnvelope;
  sessionId?: string;
}

export interface AgentExecutor {
  protocol: ExecutionProtocol;
  execute(connection: AgentConnectionConfig, request: ExecutionRequest): Promise<ExecutionStartResult>;
  cancel?(connection: AgentConnectionConfig, trialId: string): Promise<void>;
}

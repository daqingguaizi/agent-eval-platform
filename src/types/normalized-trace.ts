export type SpanKind = "llm" | "tool" | "retrieval" | "guardrail";
export type SpanStatus = "ok" | "error";
export type TraceSource = "eval" | "production" | "replay" | "simulate";

export interface SpanError {
  message: string;
  code?: string;
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  kind: SpanKind;
  name: string;
  input?: unknown;
  output?: unknown;
  startTime: number;
  durationMs?: number;
  status?: SpanStatus;
  error?: SpanError;
}

export interface Attachment {
  name?: string;
  type?: string;
  url?: string;
}

export interface TraceInput {
  type: "text" | "multi-turn";
  message: string;
  attachments?: Attachment[];
  history?: string[];
}

export interface Artifact {
  type: string;
  url?: string;
  content?: string;
}

export interface Outcome {
  finalText: string;
  artifacts?: Artifact[];
  success?: boolean;
}

export interface TraceUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  toolCalls?: number;
  latencyMs?: number;
  costCny?: number;
}

export interface TraceVersions {
  agent?: string;
  skill?: string;
  model?: string;
  judge?: string;
}

export interface NormalizedTrace {
  traceId: string;
  eventKey?: string;
  sessionId: string;
  turnId: string;
  agentType: string;
  agentId: string;
  skillId?: string;
  caseId?: string;
  source: TraceSource;
  runId?: string;
  trialId?: string;
  input: TraceInput;
  spans: Span[];
  outcome: Outcome;
  stateBefore?: Record<string, unknown>;
  stateAfter?: Record<string, unknown>;
  usage: TraceUsage;
  versions: TraceVersions;
  startTime: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

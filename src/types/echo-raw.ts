export interface EchoFunctionCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface EchoToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  durationMs?: number;
  error?: { message: string; code?: string };
}

export interface EchoMessageDetail {
  status: "pending" | "completed";
  step?: number;
  toolCalls?: EchoFunctionCall[];
  results?: EchoToolResult[];
}

export interface EchoMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text?: string;
  title?: string;
  references?: unknown[];
  detail?: EchoMessageDetail;
}

export interface EchoCanvasNode {
  id: string;
  type: string;
  title?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
}

export interface EchoCanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind?: "flow" | "story-choice" | "game-outcome";
  outcomeId?: string;
  sourcePortId?: string;
  targetPortId?: string;
}

export interface EchoCanvasSnapshot {
  projectId?: string;
  title?: string;
  canvasType?: "content" | "story";
  nodes?: EchoCanvasNode[];
  connections?: EchoCanvasConnection[];
  selectedNodeIds?: string[];
  viewport?: unknown;
  clientId?: string;
}

export interface EchoOpRejection {
  op: unknown;
  reason: string;
}

export interface EchoRawTrace {
  protocolVersion?: "v1";
  traceId?: string;
  sessionId: string;
  turnId?: string;
  messages: EchoMessage[];
  snapshotBefore?: EchoCanvasSnapshot;
  snapshotAfter?: EchoCanvasSnapshot;
  rejections?: EchoOpRejection[];
  model?: string;
  skillId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costCny?: number };
  loopStep?: number;
  startTime?: number;
  durationMs?: number;
}

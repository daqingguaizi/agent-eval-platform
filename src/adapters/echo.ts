import type { TraceAdapter } from "@/types";
import type { EchoMessage, EchoRawTrace, EchoToolResult } from "@/types/echo-raw";
import type { NormalizedTrace, Span } from "@/types/normalized-trace";

export class EchoTraceAdapter implements TraceAdapter<EchoRawTrace> {
  agentType = "task-execution";
  agentId = "echo";

  toNormalizedTrace(raw: EchoRawTrace): NormalizedTrace {
    const startTime = raw.startTime ?? Date.now();
    const userMessage = raw.messages.find((message) => message.role === "user");
    const assistantMessages = raw.messages.filter((message) => message.role === "assistant");
    const finalAssistant = assistantMessages.at(-1);
    const turnId = raw.turnId ?? userMessage?.id ?? `echo-step-${raw.loopStep ?? 0}`;
    const spans = this.createSpans(raw, startTime, turnId);

    return {
      traceId: raw.traceId ?? `${raw.sessionId}:${turnId}`,
      sessionId: raw.sessionId,
      turnId,
      agentType: this.agentType,
      agentId: this.agentId,
      skillId: raw.skillId,
      source: "eval",
      input: {
        type: "text",
        message: userMessage?.text ?? "",
        attachments: (userMessage?.references ?? []).map((reference) => {
          const value = reference as Record<string, unknown>;
          return { name: value.name as string | undefined, type: value.type as string | undefined, url: value.url as string | undefined };
        }),
      },
      spans,
      outcome: { finalText: finalAssistant?.text ?? "", success: !raw.messages.some((message) => message.role === "error") },
      stateBefore: raw.snapshotBefore ? this.snapshotToState(raw.snapshotBefore) : undefined,
      stateAfter: raw.snapshotAfter ? this.snapshotToState(raw.snapshotAfter) : undefined,
      usage: {
        ...raw.usage,
        toolCalls: spans.filter((span) => span.kind === "tool").length,
        latencyMs: raw.durationMs,
      },
      versions: { model: raw.model, skill: raw.skillId },
      startTime,
      durationMs: raw.durationMs,
      meta: { canvasType: raw.snapshotBefore?.canvasType ?? raw.snapshotAfter?.canvasType, rejections: raw.rejections ?? [], echoLoopStep: raw.loopStep },
    };
  }

  private createSpans(raw: EchoRawTrace, startTime: number, turnId: string): Span[] {
    const spans: Span[] = [];
    const errors = raw.messages.filter((message) => message.role === "error");
    for (const [messageIndex, message] of raw.messages.entries()) {
      if (message.role !== "assistant" || !message.detail?.toolCalls?.length) continue;
      const llmSpanId = `${turnId}:llm:${messageIndex}`;
      spans.push({
        spanId: llmSpanId,
        kind: "llm",
        name: raw.model ?? "echo-model",
        input: { step: message.detail.step },
        output: { toolCalls: message.detail.toolCalls.map((call) => call.function.name), text: message.text },
        startTime,
        status: "ok",
      });
      for (const call of message.detail.toolCalls) {
        const result = this.findToolResult(raw.messages, call.id);
        const errorMessage = result?.error?.message ?? errors.find((error) => error.text?.includes(call.id) || error.text?.includes(call.function.name))?.text;
        spans.push({
          spanId: `${turnId}:tool:${call.id}`,
          parentSpanId: llmSpanId,
          kind: "tool",
          name: call.function.name,
          input: this.parseArguments(call.function.arguments),
          output: result?.result ?? null,
          startTime,
          durationMs: result?.durationMs,
          status: errorMessage ? "error" : "ok",
          error: errorMessage ? { message: errorMessage, code: result?.error?.code } : undefined,
        });
      }
    }
    for (const [index, rejection] of (raw.rejections ?? []).entries()) {
      spans.push({
        spanId: `${turnId}:guardrail:${index}`,
        kind: "guardrail",
        name: "canvas-safety-constraint",
        input: rejection.op,
        output: { rejected: true, reason: rejection.reason },
        startTime,
        status: "ok",
      });
    }
    return spans;
  }

  private findToolResult(messages: EchoMessage[], toolCallId: string): EchoToolResult | undefined {
    return messages.flatMap((message) => message.detail?.results ?? []).find((result) => result.toolCallId === toolCallId);
  }

  private parseArguments(args: string): unknown {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }

  private snapshotToState(snapshot: NonNullable<EchoRawTrace["snapshotBefore"]>): Record<string, unknown> {
    return {
      canvasType: snapshot.canvasType,
      nodes: (snapshot.nodes ?? []).map(({ id, type, title, position, width, height }) => ({ id, type, title, position, width, height })),
      connections: (snapshot.connections ?? []).map(({ id, fromNodeId, toNodeId, kind }) => ({ id, fromNodeId, toNodeId, kind })),
    };
  }
}

export const echoAdapter = new EchoTraceAdapter();

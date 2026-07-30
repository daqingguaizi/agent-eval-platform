import type { NormalizedTrace } from "@/types/normalized-trace";

export interface LlmJudgeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type LlmVerdict = "pass" | "soft_pass" | "fail" | "skipped";

export interface LlmJudgeResult {
  dimension: string;
  verdict: LlmVerdict;
  score: number;
  reason: string;
}

/**
 * LLM-as-Judge 评分器：评估创意质量等主观维度。
 *
 * 优雅降级：未配置 API Key 时返回 verdict="skipped"（聚合时忽略），
 * 既不报错，也不误判为 fail/soft_pass。
 * 配置优先级：入参 config（前端注入）> 环境变量。
 */
export async function runLlmJudge(
  trace: NormalizedTrace,
  dimensions: string[],
  config: LlmJudgeConfig = {}
): Promise<LlmJudgeResult[]> {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = config.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = config.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  // 无 key：优雅降级，标记 skipped
  if (!apiKey) {
    return dimensions.map((d) => ({
      dimension: d,
      verdict: "skipped" as const,
      score: 0,
      reason: "未配置 LLM API Key，已跳过 LLM 评分",
    }));
  }

  const results: LlmJudgeResult[] = [];
  for (const dim of dimensions) {
    const prompt = buildJudgePrompt(trace, dim);
    try {
      const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
      if (!resp.ok) {
        results.push({
          dimension: dim,
          verdict: "skipped",
          score: 0,
          reason: `LLM 接口返回 ${resp.status}，已跳过该维度`,
        });
        continue;
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      results.push(parseJudgeResponse(dim, content));
    } catch (e) {
      results.push({
        dimension: dim,
        verdict: "skipped",
        score: 0,
        reason: `LLM 调用失败，已跳过：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return results;
}

function buildJudgePrompt(trace: NormalizedTrace, dimension: string): string {
  return `你是一个专业的 AI Agent 评测专家。请评估以下 Agent 执行轨迹在"${dimension}"维度的表现。

输入：${JSON.stringify(trace.input)}
输出：${JSON.stringify(trace.outcome)}

请只返回 JSON，格式：{"verdict": "pass|soft_pass|fail", "score": 0-1, "reason": "简要理由"}`;
}

function parseJudgeResponse(dimension: string, content: string): LlmJudgeResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const verdict: LlmVerdict =
        parsed.verdict === "pass" || parsed.verdict === "fail" || parsed.verdict === "soft_pass"
          ? parsed.verdict
          : "soft_pass";
      return {
        dimension,
        verdict,
        score: typeof parsed.score === "number" ? parsed.score : 0.5,
        reason: parsed.reason ?? "",
      };
    }
  } catch {
    // ignore parse error
  }
  return {
    dimension,
    verdict: "soft_pass",
    score: 0.5,
    reason: `无法解析 LLM 响应：${content.slice(0, 50)}`,
  };
}

/**
 * 聚合多维 LLM 结果为单一结论。
 * 忽略 skipped；全 skipped 时整体 skipped（不影响规则主判）。
 */
export function aggregateLlmResults(results: LlmJudgeResult[]): {
  verdict: LlmVerdict;
  reason: string;
} {
  const effective = results.filter((r) => r.verdict !== "skipped");
  if (effective.length === 0) {
    return { verdict: "skipped", reason: "LLM 评分已跳过" };
  }
  const hasFail = effective.some((r) => r.verdict === "fail");
  const allPass = effective.every((r) => r.verdict === "pass");
  const reason = effective.map((r) => `${r.dimension}: ${r.reason}`).join("; ");
  return {
    verdict: hasFail ? "fail" : allPass ? "pass" : "soft_pass",
    reason,
  };
}

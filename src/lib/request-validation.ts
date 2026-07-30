import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CALLBACK_AGE_MS = 5 * 60 * 1000;

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function verifyCallbackSignature(headers: Headers, rawBody: string, secret: string | undefined): string | null {
  if (!secret) return "连接未配置服务端回调密钥引用";
  const timestamp = headers.get("x-eval-timestamp");
  const nonce = headers.get("x-eval-nonce");
  const signature = headers.get("x-eval-signature");
  if (!timestamp || !nonce || !signature) return "缺少回调签名头";
  if (!Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > MAX_CALLBACK_AGE_MS) return "回调时间戳无效或已过期";
  const expected = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");
  const given = Buffer.from(signature, "hex");
  const target = Buffer.from(expected, "hex");
  if (given.length !== target.length || !timingSafeEqual(given, target)) return "回调签名校验失败";
  return null;
}

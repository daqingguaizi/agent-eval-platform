/**
 * 前端 fetch 封装
 * 统一处理 { code, data, msg } 响应结构
 */

export interface ApiResp<T = unknown> {
  code: number;
  data: T;
  msg: string;
}

export async function request<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const json: ApiResp<T> = await resp.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `请求失败 (code: ${json.code})`);
  }
  return json.data;
}

export function get<T = unknown>(url: string): Promise<T> {
  return request<T>(url);
}

export function post<T = unknown>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * 统一 API 响应结构（对齐主站 { code, data, msg }）
 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  msg: string;
}

export function ok<T>(data: T, msg = "success"): ApiResponse<T> {
  return { code: 0, data, msg };
}

export function fail(msg: string, code = -1): ApiResponse<null> {
  return { code, data: null, msg };
}

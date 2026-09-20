export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? "请求失败",
      body.error?.code ?? "ERROR",
      response.status,
      body.error?.details,
    );
  return body;
}
export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function percent(value: number | null) {
  return value === null ? "—" : Math.round(value * 100) + "%";
}
export function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "W";
}

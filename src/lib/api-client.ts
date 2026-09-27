"use client";

/** Typed API client — all requests relative paths through the gateway (platform rule). */

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<T> {
  const headers: Record<string, string> = { "x-requested-with": "fetch", ...opts?.headers };
  let payload: string | undefined;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = undefined as unknown as string;
    } else {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    }
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body instanceof FormData ? body : payload,
    signal: opts?.signal,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const errObj = (data && typeof data === "object" ? (data as Record<string, unknown>) : {});
    throw new ApiError(
      (errObj.error as string) || `Request failed (${res.status})`,
      res.status,
      errObj.code as string | undefined,
      errObj.details
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, { signal }),
  post: <T>(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

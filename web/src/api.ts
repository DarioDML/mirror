// Small API client. The token lives in memory only (not localStorage), so a script injected into the page
// cannot read a long-lived token from storage. Reloading the page logs you out, which is fine for a demo.

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Opts = { method?: string; body?: unknown };

async function request(path: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail))
        msg = j.detail
          .map((d: { loc?: (string | number)[]; msg: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`)
          .join("\n");
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  return (await request(path, opts)).json() as Promise<T>;
}

export async function apiBlob(path: string, method = "POST"): Promise<Blob> {
  return (await request(path, { method })).blob();
}

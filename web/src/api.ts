export type ApiOpts = { method?: string; body?: unknown; signal?: AbortSignal };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Api = {
  json<T>(path: string, opts?: ApiOpts): Promise<T>;
  blob(path: string, method?: string, signal?: AbortSignal): Promise<Blob>;
};

type DetailItem = { loc?: (string | number)[]; msg: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function detailMessage(j: unknown, fallback: string): string {
  if (!isRecord(j)) return fallback;
  const d = j["detail"];
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d
      .filter((x): x is DetailItem => isRecord(x) && typeof x["msg"] === "string")
      .map((x) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`)
      .join("\n");
  return fallback;
}

export function makeApi(getToken: () => string | null, onUnauthorized: () => void): Api {
  async function request(path: string, opts: ApiOpts): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    if (res.status === 401 && token) onUnauthorized();
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = detailMessage(await res.json(), msg);
      } catch {
        msg = res.statusText;
      }
      throw new ApiError(res.status, msg);
    }
    return res;
  }
  return {
    async json<T>(path: string, opts: ApiOpts = {}): Promise<T> {
      return (await request(path, opts)).json() as Promise<T>;
    },
    async blob(path: string, method = "POST", signal?: AbortSignal): Promise<Blob> {
      return (await request(path, { method, signal })).blob();
    },
  };
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setToken(t: string | null): void {
  token = t;
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

const defaultApi = makeApi(
  () => token,
  () => onUnauthorized(),
);

export async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  return defaultApi.json<T>(path, opts);
}

export async function apiBlob(path: string, method = "POST"): Promise<Blob> {
  return defaultApi.blob(path, method);
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

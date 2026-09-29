import { AuthRequired, ForbiddenOperation, HaziHinamError, UpstreamError } from "./errors.js";

export const SITE_ORIGIN = "https://shop.hazi-hinam.co.il";
export const API_BASE = `${SITE_ORIGIN}/proxy/api/`;

const DEVICE_INFO = JSON.stringify({ DEVICE_TYPE: 4, UDID: "", MANUFACTURER: "", MODEL: "", VERSION: "" });
// Verified live with this exact value; the site sits behind Cloudflare.
const USER_AGENT = "Mozilla/5.0";

// Payment is out of scope for now: order/post takes card details and places the order; user/cc and
// GetIFrameURL are card management. Lifting this is a deliberate, separately planned change.
const FORBIDDEN_PATHS = [/^order\/post\b/i, /^user\/cc\b/i, /^user\/GetIFrameURL\b/i];

interface Envelope<T> {
  IsOK: boolean;
  Results: T;
  ErrorResponse: { ErrorCode?: number | string; ErrorDescription?: string } | null;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HaziHinamClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly token: string, options: ClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  // The site's ApiService wraps every POST/PUT body this way; a bare body is answered with HTTP 500.
  post<T>(path: string, payload: unknown = {}): Promise<T> {
    return this.request<T>("POST", path, { Object: payload });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, rawPath: string, body?: unknown, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(rawPath.replace(/^\/+/, ""), API_BASE);
    if (url.origin !== SITE_ORIGIN || !url.pathname.startsWith("/proxy/api/")) {
      throw new HaziHinamError("BAD_PATH", `Refusing to call ${rawPath}: not a path under ${API_BASE}`);
    }
    const path = url.pathname.slice("/proxy/api/".length);
    if (FORBIDDEN_PATHS.some(pattern => pattern.test(path))) throw new ForbiddenOperation(path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      DEVICE_INFO,
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(`${method} ${path} did not complete: ${(error as Error).message}`);
    }

    if (response.status === 401) throw new AuthRequired();
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new UpstreamError(`${method} ${path} response could not be read: ${(error as Error).message}`, response.status);
    }
    if (!response.ok) throw new UpstreamError(`${method} ${path} failed with HTTP ${response.status}`, response.status);

    let envelope: Envelope<T> | null;
    try {
      envelope = JSON.parse(text) as Envelope<T> | null;
    } catch {
      throw new UpstreamError(`${method} ${path} returned a non-JSON response`, response.status);
    }
    if (typeof envelope !== "object" || envelope === null) {
      throw new UpstreamError(`${method} ${path} returned an unexpected response`, response.status);
    }
    if (!envelope.IsOK) {
      throw new UpstreamError(`${method} ${path} was rejected: ${envelope.ErrorResponse?.ErrorDescription ?? "no reason given"}`, response.status);
    }
    return envelope.Results;
  }
}

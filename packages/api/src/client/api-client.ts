import { setServerClockOffset } from './server-clock.js';

/**
 * Feed the server clock from a response's `Date` header, so presence dots can
 * measure staleness against server time instead of a possibly-skewed browser
 * clock. Cheap and self-refreshing — runs on every polled response.
 */
function captureServerDate(res: Response): void {
  const d = res.headers.get('date');
  if (!d) return;
  const serverMs = Date.parse(d);
  if (!Number.isNaN(serverMs)) setServerClockOffset(serverMs - Date.now());
}

/** Typed fetch wrapper for backend NestJS endpoints. */
export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /**
   * Optional: force a real session refresh and return the fresh token. Called on
   * a 401 before retrying — unlike `getToken()` (which may return the same
   * expired/cached token), this should actually renew the session (e.g.
   * `supabase.auth.refreshSession()`). Without it, the 401 retry just re-sends
   * the same dead token. Falls back to `getToken()` when not provided.
   */
  refreshToken?: () => Promise<string | null>;
  /** Optional hook for structured client logging (e.g. admin-web clientLogger). */
  onApiError?: (info: {
    method: string;
    path: string;
    status: number;
    message: string;
    data?: unknown;
  }) => void;
  /**
   * Static headers sent on every request. Used by the mobile client to
   * declare capabilities (e.g. `X-Sync-Caps: tombstones-v1`) the server
   * inspects when deciding the response shape. Standard headers
   * (`Content-Type`, `Authorization`) take precedence.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * Default per-request abort timeout in milliseconds. `undefined` (the
   * default) means no timeout — `fetch` waits indefinitely, which is the
   * historical behaviour and what admin-web keeps relying on.
   *
   * Mobile sets this because a screen an operator stands in a field
   * depends on: with bars but no throughput (a common in-field condition),
   * an un-timed `fetch` never settles, so a query built on it never fails
   * over to its offline fallback either — it just hangs forever. See
   * individual call sites for per-request overrides (a sync pull/push or a
   * multipart upload legitimately needs longer than a plain GET).
   */
  timeoutMs?: number;
}

/** Per-call override of {@link ApiClientConfig.timeoutMs}. */
export interface ApiRequestOptions {
  timeoutMs?: number;
}

export class ApiClient {
  constructor(private config: ApiClientConfig) {}

  /**
   * Build a *fresh* abort signal for a single fetch attempt. Must be called
   * again for every retry — an already-fired/consumed `AbortSignal` cannot be
   * reused, so sharing one across the initial request and its 401 retry would
   * make the retry fail instantly once the first attempt's timer had fired.
   */
  private withTimeout(ms: number | undefined): {
    signal: AbortSignal | undefined;
    clear: () => void;
  } {
    if (ms == null) return { signal: undefined, clear: () => {} };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      // Self-managed timer; nothing for us to clear.
      return { signal: AbortSignal.timeout(ms), clear: () => {} };
    }
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(handle) };
  }

  /** Runs `fetch`, converting our own timeout abort into a typed `ApiError(0, ...)`. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number | undefined,
  ): Promise<Response> {
    const { signal, clear } = this.withTimeout(timeoutMs);
    try {
      return await fetch(url, signal ? { ...init, signal } : init);
    } catch (err) {
      if (signal?.aborted) {
        throw new ApiError(0, 'Request timed out');
      }
      throw err;
    } finally {
      clear();
    }
  }

  private async handleErrorResponse(
    res: Response,
    method: string,
    path: string,
    fallbackMessage: string,
  ): Promise<never> {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    const message = (error as { message?: string }).message ?? fallbackMessage;
    this.config.onApiError?.({
      method,
      path,
      status: res.status,
      message,
      data: error,
    });
    throw new ApiError(res.status, message, error);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: ApiRequestOptions,
  ): Promise<T> {
    const token = await this.config.getToken();
    const hasBody = body !== undefined;
    const timeoutMs = opts?.timeoutMs ?? this.config.timeoutMs;
    const buildHeaders = (t: string | null) => ({
      ...(this.config.defaultHeaders ?? {}),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    });
    const doFetch = (t: string | null) =>
      this.fetchWithTimeout(
        `${this.config.baseUrl}${path}`,
        {
          method,
          headers: buildHeaders(t),
          body: hasBody ? JSON.stringify(body) : undefined,
        },
        timeoutMs,
      );
    const res = await doFetch(token);
    captureServerDate(res);

    // On 401, force a real token refresh and retry once. `doFetch` builds a
    // fresh abort signal per call, so the retry is never stuck with the
    // initial attempt's already-fired timer.
    if (res.status === 401) {
      const newToken = this.config.refreshToken
        ? await this.config.refreshToken()
        : await this.config.getToken();
      const retryRes = await doFetch(newToken);
      captureServerDate(retryRes);
      if (!retryRes.ok) {
        return this.handleErrorResponse(retryRes, method, path, 'Request failed');
      }
      if (retryRes.status === 204) return undefined as T;
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      return this.handleErrorResponse(res, method, path, 'Request failed');
    }
    // Handle 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  get<T>(path: string, opts?: ApiRequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }
  post<T>(path: string, body?: unknown, opts?: ApiRequestOptions) {
    return this.request<T>('POST', path, body, opts);
  }
  put<T>(path: string, body?: unknown, opts?: ApiRequestOptions) {
    return this.request<T>('PUT', path, body, opts);
  }
  patch<T>(path: string, body?: unknown, opts?: ApiRequestOptions) {
    return this.request<T>('PATCH', path, body, opts);
  }
  delete<T>(path: string, opts?: ApiRequestOptions) {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  /**
   * Turn a server-relative URL (e.g. `/api/v1/uploads/avatars/abc.webp?v=1`)
   * into something an `<img>` or React Native `<Image>` can actually load.
   *
   * - Absolute URLs are returned unchanged.
   * - When `baseUrl` is empty (admin-web dev, which relies on same-origin
   *   Next.js rewrites), the relative URL is returned as-is.
   * - Otherwise the `baseUrl` is prepended.
   *
   * Returns `null` for nullish/blank input so callers can pass
   * `user.avatarUrl` (a nullable column) directly.
   */
  resolveAssetUrl(relative: string | null | undefined): string | null {
    if (!relative) return null;
    if (/^https?:\/\//i.test(relative)) return relative;
    if (!this.config.baseUrl) return relative;
    return `${this.config.baseUrl}${relative}`;
  }

  /** Upload a file via multipart form data. */
  async upload<T>(path: string, formData: FormData, opts?: ApiRequestOptions): Promise<T> {
    const token = await this.config.getToken();
    const timeoutMs = opts?.timeoutMs ?? this.config.timeoutMs;
    const buildUploadHeaders = (t: string | null) => ({
      ...(this.config.defaultHeaders ?? {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    });
    const doFetch = (t: string | null) =>
      this.fetchWithTimeout(
        `${this.config.baseUrl}${path}`,
        {
          method: 'POST',
          headers: buildUploadHeaders(t),
          body: formData,
        },
        timeoutMs,
      );
    const res = await doFetch(token);

    // On 401, force a real token refresh and retry once (fresh signal — see request()).
    if (res.status === 401) {
      const newToken = this.config.refreshToken
        ? await this.config.refreshToken()
        : await this.config.getToken();
      const retryRes = await doFetch(newToken);
      if (!retryRes.ok) {
        return this.handleErrorResponse(retryRes, 'POST', path, 'Upload failed');
      }
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      return this.handleErrorResponse(res, 'POST', path, 'Upload failed');
    }
    return res.json() as Promise<T>;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

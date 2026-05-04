/** Typed fetch wrapper for backend NestJS endpoints. */
export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Optional hook for structured client logging (e.g. admin-web clientLogger). */
  onApiError?: (info: {
    method: string;
    path: string;
    status: number;
    message: string;
    data?: unknown;
  }) => void;
}

export class ApiClient {
  constructor(private config: ApiClientConfig) {}

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.config.getToken();
    const hasBody = body !== undefined;
    const buildHeaders = (t: string | null) => ({
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    });
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: buildHeaders(token),
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    // On 401, refresh the token and retry once
    if (res.status === 401) {
      const newToken = await this.config.getToken();
      const retryRes = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: buildHeaders(newToken),
        body: hasBody ? JSON.stringify(body) : undefined,
      });
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

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
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
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const token = await this.config.getToken();
    const buildUploadHeaders = (t: string | null) => ({
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    });
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: buildUploadHeaders(token),
      body: formData,
    });

    // On 401, refresh the token and retry once
    if (res.status === 401) {
      const newToken = await this.config.getToken();
      const retryRes = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: buildUploadHeaders(newToken),
        body: formData,
      });
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

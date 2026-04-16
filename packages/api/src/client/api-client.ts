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
        const error = await retryRes.json().catch(() => ({ message: retryRes.statusText }));
        const message = error.message ?? 'Request failed';
        this.config.onApiError?.({
          method,
          path,
          status: retryRes.status,
          message,
          data: error,
        });
        throw new ApiError(retryRes.status, message, error);
      }
      if (retryRes.status === 204) return undefined as T;
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      const message = error.message ?? 'Request failed';
      this.config.onApiError?.({
        method,
        path,
        status: res.status,
        message,
        data: error,
      });
      throw new ApiError(res.status, message, error);
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

  /** Upload a file via multipart form data. */
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const token = await this.config.getToken();
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      const message = error.message ?? 'Upload failed';
      this.config.onApiError?.({
        method: 'POST',
        path,
        status: res.status,
        message,
        data: error,
      });
      throw new ApiError(res.status, message, error);
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

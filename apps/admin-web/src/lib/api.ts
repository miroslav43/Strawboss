import { ApiClient } from '@strawboss/api';
import { supabase } from './supabase';

/**
 * In `next dev`, use same-origin `/api/v1` so Next.js rewrites can proxy to
 * NEXT_PUBLIC_API_URL (avoids CORS when the UI is localhost and the API is remote).
 * In production builds, use the public API URL baked at build time.
 */
const apiBaseUrl =
  process.env.NODE_ENV === 'development'
    ? ''
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');

export const apiClient = new ApiClient({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  onApiError: (info) => {
    if (typeof window === 'undefined') return;
    void import('./client-logger').then(({ clientLogger }) => {
      clientLogger.error(`API ${info.method} ${info.path} failed`, {
        status: info.status,
        message: info.message,
        data: info.data,
      });
    });
  },
});

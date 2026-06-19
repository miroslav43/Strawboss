import { ApiClient } from '@strawboss/api';
import { getAuthToken, refreshAuthToken } from './auth';
import { mobileLogger } from './logger';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Resolve a server-relative path (e.g. `/api/v1/uploads/specimens/abc.png?v=1`)
 * to a fully qualified URL that React Native's `Image` / `fetch` can consume.
 * Returns the input unchanged if it's already absolute.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${API_URL}${pathOrUrl}`;
  return `${API_URL}/${pathOrUrl}`;
}

/**
 * Shared ApiClient singleton for mobile.
 * Uses the current Supabase session token for all requests.
 */
export const mobileApiClient = new ApiClient({
  baseUrl: API_URL,
  getToken: getAuthToken,
  // On 401, force a real session refresh (not just re-read the cached token) so
  // a backgrounded device recovers from an expired access token instead of
  // 401-ing forever and dropping presence. See refreshAuthToken.
  refreshToken: refreshAuthToken,
  // Declare client capabilities so the server can return forward-compatible
  // response shapes. `tombstones-v1` makes /sync/pull include a `deletions[]`
  // array for soft-deleted rows so the local cache can converge.
  defaultHeaders: {
    'X-Sync-Caps': 'tombstones-v1',
  },
  onApiError: ({ method, path, status, message, data }) => {
    mobileLogger.error(`API ${method} ${path} failed`, {
      status,
      message,
      data,
    });
  },
});

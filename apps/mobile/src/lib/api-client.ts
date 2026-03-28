import { ApiClient } from '@strawboss/api';
import { getAuthToken } from './auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Shared ApiClient singleton for mobile.
 * Uses the current Supabase session token for all requests.
 */
export const mobileApiClient = new ApiClient({
  baseUrl: API_URL,
  getToken: getAuthToken,
});

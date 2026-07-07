import { createClient } from '@strawboss/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { secureStoreAdapter } from './secure-store-adapter';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or initialize the Supabase client singleton.
 *
 * On React Native there is no `localStorage`, so we hand Supabase a
 * SecureStore-backed adapter — otherwise the session lives only in memory and is
 * lost on cold start, forcing a re-login every shift. With this, the session
 * persists (and auto-refreshes) until the operator explicitly logs out.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      storage: secureStoreAdapter,
      detectSessionInUrl: false,
    });
  }
  return supabaseClient;
}

/**
 * Get the current auth token for API requests.
 * Returns null if no active session.
 */
export async function getAuthToken(): Promise<string | null> {
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Force a real session refresh and return the fresh access token. Used by the
 * ApiClient on a 401 — unlike {@link getAuthToken}, this renews the session
 * instead of returning the (possibly expired) cached token. Returns null if the
 * refresh fails (e.g. revoked refresh token) so the caller can treat it as
 * unauthenticated.
 */
export async function refreshAuthToken(): Promise<string | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

/**
 * Start/stop Supabase's background token auto-refresh ticker. supabase-js does
 * NOT auto-start it on React Native — without this the access token expires
 * (~1 h) and every authenticated request 401s once the screen has been off long
 * enough. Wired to AppState in `app/_layout.tsx`.
 */
export function startAuthAutoRefresh(): void {
  void getSupabaseClient().auth.startAutoRefresh();
}

export function stopAuthAutoRefresh(): void {
  void getSupabaseClient().auth.stopAutoRefresh();
}

/**
 * Check if the user is currently authenticated.
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== null;
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  await client.auth.signOut();
}

// In-flight flag distinguishing a user-initiated logout from an SDK-emitted
// `SIGNED_OUT` event (e.g. a revoked/expired refresh token after a long
// offline stretch). Set by the logout handler (ProfileScreen) *before*
// calling `signOut()` and read by the `onAuthStateChange` listener in
// `app/_layout.tsx`: manual logout is the only path allowed to wipe local
// SQLite data (and only after the operator confirms, if a sync queue is
// pending) — an automatic `SIGNED_OUT` must never touch it.
let manualSignOutInFlight = false;

export function setManualSignOutInFlight(value: boolean): void {
  manualSignOutInFlight = value;
}

export function isManualSignOutInFlight(): boolean {
  return manualSignOutInFlight;
}

import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

/**
 * Storage backend for the auth session. Mirrors Supabase's `SupportedStorage`
 * so callers can pass a platform-specific adapter (e.g. a SecureStore-backed
 * adapter on React Native) without importing Supabase's internal types.
 */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface CreateClientOptions {
  /**
   * Where to persist the auth session. Omit on web (Supabase defaults to
   * `localStorage`). On React Native there is no `localStorage`, so the session
   * lives only in memory and is lost on cold start unless an adapter is passed.
   */
  storage?: AuthStorage;
  /** Disable on React Native (no URL to parse). Defaults to Supabase's default. */
  detectSessionInUrl?: boolean;
}

export function createClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: CreateClientOptions,
): SupabaseClient {
  return createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      // Keep the session across restarts and refresh the access token in the
      // background, so a signed-in operator stays signed in until they log out.
      persistSession: true,
      autoRefreshToken: true,
      ...(options?.storage ? { storage: options.storage } : {}),
      ...(options?.detectSessionInUrl !== undefined
        ? { detectSessionInUrl: options.detectSessionInUrl }
        : {}),
    },
  });
}

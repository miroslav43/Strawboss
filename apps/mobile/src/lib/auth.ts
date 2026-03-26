import { createClient } from '@strawboss/api';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or initialize the Supabase client singleton.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

import * as SecureStore from 'expo-secure-store';
import type { AuthStorage } from '@strawboss/api';

/**
 * SecureStore-backed storage adapter for the Supabase auth session.
 *
 * Without a storage adapter, supabase-js on React Native falls back to in-memory
 * storage, so the session is lost on every cold start and operators must log in
 * again each shift. We persist it in `expo-secure-store` (encrypted at rest).
 *
 * SecureStore caps each value at ~2048 bytes; a Supabase session JSON (JWT +
 * refresh token + user) exceeds that, so we transparently split large values
 * into UTF-8-byte-bounded chunks across sibling keys and reassemble on read.
 */

// Headroom under SecureStore's 2048-byte ceiling.
const MAX_CHUNK_BYTES = 1800;

const metaKey = (key: string) => `${key}__sbchunks`;
const chunkKey = (key: string, i: number) => `${key}__sb${i}`;

/** UTF-8 byte length of a single code point. */
function utf8Len(codePoint: string): number {
  const c = codePoint.codePointAt(0) ?? 0;
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c < 0x10000) return 3;
  return 4;
}

/** Split on code-point boundaries so each chunk's UTF-8 size stays under the cap. */
function chunkByBytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of value) {
    const b = utf8Len(ch);
    if (curBytes + b > maxBytes && cur.length > 0) {
      chunks.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Delete every representation (plain value + any chunk set) for a key. */
async function clearAll(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
  const meta = await SecureStore.getItemAsync(metaKey(key));
  if (meta != null) {
    const count = Number.parseInt(meta, 10) || 0;
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(metaKey(key));
  }
}

export const secureStoreAdapter: AuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const meta = await SecureStore.getItemAsync(metaKey(key));
    if (meta == null) {
      // Not chunked — small value stored under the plain key (or absent).
      return SecureStore.getItemAsync(key);
    }
    const count = Number.parseInt(meta, 10) || 0;
    let out = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null; // corrupt/partial — treat as missing
      out += part;
    }
    return out;
  },

  setItem: async (key: string, value: string): Promise<void> => {
    await clearAll(key);
    const chunks = chunkByBytes(value, MAX_CHUNK_BYTES);
    if (chunks.length <= 1) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
    }
    await SecureStore.setItemAsync(metaKey(key), String(chunks.length));
  },

  removeItem: async (key: string): Promise<void> => {
    await clearAll(key);
  },
};

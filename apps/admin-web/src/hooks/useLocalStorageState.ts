'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Persists a small JSON-serialisable state object in `localStorage`.
 * SSR-safe — initial render uses the fallback value, then re-hydrates
 * from storage on the client.
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        setValue(parsed);
      }
    } catch {
      // Ignore malformed values — keep the fallback.
    }
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(key, JSON.stringify(resolved));
          }
        } catch {
          // Quota / private mode — ignore.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}

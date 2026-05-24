'use client';

import { useEffect, useReducer } from 'react';
import { cn } from '@/lib/utils';

// 30 s mobile heartbeat + 60 s grace → 90 s window.
const ONLINE_WINDOW_MS = 90 * 1000;

// Shared 30 s tick so we don't run one timer per dot.
const subscribers = new Set<() => void>();
if (typeof window !== 'undefined') {
  setInterval(() => {
    for (const sub of subscribers) sub();
  }, 30_000);
}

function useTick() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(force);
    return () => {
      subscribers.delete(force);
    };
  }, []);
}

export interface UserPresenceDotProps {
  /** ISO timestamp from users.last_seen_at — null = never connected. */
  lastSeenAt: string | null | undefined;
  className?: string;
}

/**
 * Plan C — tiny green/grey dot showing whether a user is currently
 * connected (heartbeat within the last 90 s).
 */
export function UserPresenceDot({ lastSeenAt, className }: UserPresenceDotProps) {
  useTick();
  const isOnline = lastSeenAt
    ? Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS
    : false;
  return (
    <span
      title={
        lastSeenAt
          ? isOnline
            ? 'Conectat'
            : `Ultima activitate: ${new Date(lastSeenAt).toLocaleString('ro-RO')}`
          : 'Niciodată conectat'
      }
      className={cn(
        'inline-block h-2 w-2 rounded-full ring-1 ring-white',
        isOnline ? 'bg-green-500 animate-pulse' : 'bg-neutral-300',
        className,
      )}
      aria-label={isOnline ? 'online' : 'offline'}
    />
  );
}

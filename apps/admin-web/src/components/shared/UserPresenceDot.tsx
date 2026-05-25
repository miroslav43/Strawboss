'use client';

import { useEffect, useReducer } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

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
  /**
   * `dot` (default) — tiny pulsing circle, info only on hover.
   * `badge` — inline pill with colored dot + short label ("Online" / "5 min")
   * so the presence state is legible without hovering. Use on dense screens
   * (truck plan board) where users skim cards.
   */
  variant?: 'dot' | 'badge';
}

/**
 * Plan C — green/grey indicator showing whether a user is currently connected
 * (heartbeat within the last 90 s). Tooltip carries the full "last seen" text;
 * the `badge` variant also renders a short label inline.
 */
export function UserPresenceDot({ lastSeenAt, className, variant = 'dot' }: UserPresenceDotProps) {
  useTick();
  const { t, locale } = useI18n();

  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
  const ageMs = lastSeenMs != null ? Date.now() - lastSeenMs : null;
  const isOnline = ageMs != null && ageMs < ONLINE_WINDOW_MS;

  const title = lastSeenAt
    ? isOnline
      ? t('tasks.online.online')
      : t('tasks.online.lastSeen', {
          when: new Date(lastSeenAt).toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-US'),
        })
    : t('tasks.online.neverSeen');

  if (variant === 'badge') {
    const shortLabel = (() => {
      if (lastSeenAt == null || ageMs == null) return t('tasks.online.shortOffline');
      if (isOnline) return t('tasks.online.shortOnline');
      const minutes = Math.floor(ageMs / 60_000);
      if (minutes < 60) return t('tasks.online.shortMinutesAgo', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('tasks.online.shortHoursAgo', { n: hours });
      const days = Math.floor(hours / 24);
      return t('tasks.online.shortDaysAgo', { n: days });
    })();

    return (
      <span
        title={title}
        aria-label={isOnline ? 'online' : 'offline'}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1',
          isOnline
            ? 'bg-green-50 text-green-700 ring-green-200'
            : 'bg-neutral-100 text-neutral-500 ring-neutral-200',
          className,
        )}
      >
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 rounded-full',
            isOnline ? 'bg-green-500 animate-pulse' : 'bg-neutral-400',
          )}
        />
        {shortLabel}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        'inline-block h-2 w-2 rounded-full ring-1 ring-white',
        isOnline ? 'bg-green-500 animate-pulse' : 'bg-neutral-300',
        className,
      )}
      aria-label={isOnline ? 'online' : 'offline'}
    />
  );
}

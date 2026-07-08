'use client';

import { useEffect, useReducer } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

// Default window: heartbeat relaxed to ~60 s + gate on mobile (jittered
// 60-65 s JS interval, deduped against a 60 s native alarm) → 180 s tolerates
// one missed tick without flapping the dot. Caller can pass `thresholdMs` to
// widen the window — e.g. machine GPS recordings come every few minutes, so
// the Machines / Available-truck lists use 15 min.
const DEFAULT_ONLINE_WINDOW_MS = 180_000;

// Shared 30 s tick so we don't run one timer per dot. The interval is created
// lazily the first time a subscriber mounts, and torn down when the last one
// unmounts — this keeps hot-reload (Fast Refresh) from accumulating duplicate
// timers in development.
const subscribers = new Set<() => void>();
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

function ensureTick() {
  if (typeof window === 'undefined') return;
  if (tickIntervalId !== null) return;
  tickIntervalId = setInterval(() => {
    for (const sub of subscribers) sub();
  }, 30_000);
}

function maybeStopTick() {
  if (subscribers.size > 0) return;
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function useTick() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    ensureTick();
    subscribers.add(force);
    return () => {
      subscribers.delete(force);
      maybeStopTick();
    };
  }, []);
}

export interface UserPresenceDotProps {
  /**
   * ISO timestamp — for users this is `users.last_seen_at`, for machines
   * it's `machine_location_events.recorded_at`. `null` means never seen.
   */
  lastSeenAt: string | null | undefined;
  className?: string;
  /**
   * `dot` (default) — tiny pulsing circle, info only on hover.
   * `badge` — inline pill with colored dot + short label ("Online" / "5 min")
   * so the presence state is legible without hovering. Use on dense screens
   * (truck plan board) where users skim cards.
   */
  variant?: 'dot' | 'badge';
  /**
   * Override the "online" window. Default 180 s (covers a ~60 s heartbeat
   * with a missed-tick grace). For GPS-based machine presence pass 15 min.
   */
  thresholdMs?: number;
}

/**
 * Plan C — green/grey indicator showing whether a user is currently connected
 * (heartbeat within the last 180 s). Tooltip carries the full "last seen" text;
 * the `badge` variant also renders a short label inline.
 */
export function UserPresenceDot({
  lastSeenAt,
  className,
  variant = 'dot',
  thresholdMs = DEFAULT_ONLINE_WINDOW_MS,
}: UserPresenceDotProps) {
  useTick();
  const { t, locale } = useI18n();

  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
  const ageMs = lastSeenMs != null ? Date.now() - lastSeenMs : null;
  const isOnline = ageMs != null && ageMs < thresholdMs;

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
        aria-label={isOnline ? t('tasks.online.ariaOnline') : t('tasks.online.ariaOffline')}
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
      aria-label={isOnline ? t('tasks.online.ariaOnline') : t('tasks.online.ariaOffline')}
    />
  );
}

'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { USER_ONLINE_WINDOW_MS } from '@strawboss/types';
import { usePresenceState, shortAgo } from './usePresenceState';

// Default window comes from the @strawboss/types SSOT (USER_ONLINE_WINDOW_MS,
// 180 s): a ~60 s heartbeat with a missed-tick grace so the dot doesn't flap.
// Callers can widen it — machine GPS recordings come every few minutes, so the
// Machines / Available-truck lists pass MACHINE_ONLINE_WINDOW_MS (15 min).
// The shared re-tick + server-clock-corrected age live in ./usePresenceState.

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
 * (heartbeat within the online window). Tooltip carries the full "last seen"
 * text; the `badge` variant also renders a short label inline.
 */
export function UserPresenceDot({
  lastSeenAt,
  className,
  variant = 'dot',
  thresholdMs = USER_ONLINE_WINDOW_MS,
}: UserPresenceDotProps) {
  const { t, locale } = useI18n();
  const { state, ageMs } = usePresenceState(lastSeenAt, { online: thresholdMs });
  const isOnline = state === 'online';

  const title = lastSeenAt
    ? isOnline
      ? t('tasks.online.online')
      : t('tasks.online.lastSeen', {
          when: new Date(lastSeenAt).toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-US'),
        })
    : t('tasks.online.neverSeen');

  if (variant === 'badge') {
    const shortLabel =
      lastSeenAt == null || ageMs == null
        ? t('tasks.online.shortOffline')
        : isOnline
          ? t('tasks.online.shortOnline')
          : shortAgo(ageMs, t);

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

'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { DEVICE_ONLINE_WINDOW_MS, DEVICE_IDLE_WINDOW_MS } from '@strawboss/types';
import { usePresenceState, shortAgo } from './usePresenceState';

/**
 * Fleet DEVICE presence — a 3-state indicator on `devices.last_seen_at`:
 *   green  "online"  — reporting on its own (age < DEVICE_ONLINE_WINDOW_MS).
 *   amber  "dozing"  — quiet, but inside the FCM dead-man's revival envelope
 *                      (< DEVICE_IDLE_WINDOW_MS): the phone is being kept alive.
 *   red    "offline" — past the point the dead-man could revive it → really down.
 *   grey   "never"   — never checked in.
 *
 * Amber is what stops the flapping the 90 s single-window dot suffered: a
 * healthy-but-Doze-throttled phone rides the amber band instead of flipping
 * grey, without lying that a genuinely-dead phone is online. All windows come
 * from the @strawboss/types SSOT; the shared tick + server-clock age live in
 * ./usePresenceState.
 */
export function DevicePresenceDot({
  lastSeenAt,
  className,
  variant = 'dot',
}: {
  lastSeenAt: string | null | undefined;
  className?: string;
  variant?: 'dot' | 'badge';
}) {
  const { t, locale } = useI18n();
  const { state, ageMs } = usePresenceState(lastSeenAt, {
    online: DEVICE_ONLINE_WINDOW_MS,
    idle: DEVICE_IDLE_WINDOW_MS,
  });

  const title =
    state === 'online'
      ? t('fleet.presence.online')
      : state === 'idle'
        ? t('fleet.presence.dozing')
        : state === 'never'
          ? t('fleet.presence.neverSeen')
          : t('fleet.presence.lastSeen', {
              when: new Date(lastSeenAt as string).toLocaleString(
                locale === 'ro' ? 'ro-RO' : 'en-US',
              ),
            });

  const aria =
    state === 'online'
      ? t('fleet.presence.ariaOnline')
      : state === 'idle'
        ? t('fleet.presence.ariaDozing')
        : t('fleet.presence.ariaOffline');

  const dotColor =
    state === 'online'
      ? 'bg-green-500 animate-pulse'
      : state === 'idle'
        ? 'bg-amber-400 animate-pulse'
        : state === 'offline'
          ? 'bg-red-500'
          : 'bg-neutral-300';

  if (variant === 'badge') {
    const shortLabel =
      state === 'online'
        ? t('fleet.presence.shortOnline')
        : state === 'idle'
          ? t('fleet.presence.shortDozing')
          : state === 'never' || ageMs == null
            ? t('fleet.presence.shortOffline')
            : shortAgo(ageMs, t);

    const badgeTone =
      state === 'online'
        ? 'bg-green-50 text-green-700 ring-green-200'
        : state === 'idle'
          ? 'bg-amber-50 text-amber-700 ring-amber-200'
          : state === 'offline'
            ? 'bg-red-50 text-red-700 ring-red-200'
            : 'bg-neutral-100 text-neutral-500 ring-neutral-200';

    return (
      <span
        title={title}
        aria-label={aria}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1',
          badgeTone,
          className,
        )}
      >
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', dotColor)} />
        {shortLabel}
      </span>
    );
  }

  return (
    <span
      title={title}
      aria-label={aria}
      className={cn('inline-block h-2 w-2 rounded-full', dotColor, className)}
    />
  );
}

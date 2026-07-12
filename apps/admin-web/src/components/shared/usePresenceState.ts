'use client';

import { useEffect, useReducer } from 'react';
import { serverNow } from '@strawboss/api';
import { PRESENCE_RETICK_MS } from '@strawboss/types';

/**
 * Shared presence-staleness logic for every "is it online?" dot.
 *
 * Two things it centralizes so the dots can't drift or double-time:
 *  1. A SINGLE re-render tick (PRESENCE_RETICK_MS) shared across all mounted
 *     dots, so a dot ages out between data polls without one timer per dot.
 *  2. Age measured against `serverNow()` (server clock, corrected from the API
 *     `Date` header) instead of the viewer's browser clock — a fast admin PC no
 *     longer dims every dot early.
 *
 * Windows come from the `@strawboss/types` SSOT; pass `idle` for a 3-state dot
 * (online / idle / offline), omit it for a 2-state dot (online / offline).
 */

export type PresenceState = 'online' | 'idle' | 'offline' | 'never';

type TFn = (key: string, params?: Record<string, string | number>) => string;

// Shared tick: one interval for all subscribers, created lazily on first mount
// and torn down when the last dot unmounts (keeps Fast Refresh from stacking
// duplicate timers in dev).
const subscribers = new Set<() => void>();
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

function ensureTick() {
  if (typeof window === 'undefined') return;
  if (tickIntervalId !== null) return;
  tickIntervalId = setInterval(() => {
    for (const sub of subscribers) sub();
  }, PRESENCE_RETICK_MS);
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

export function usePresenceState(
  lastSeenAt: string | null | undefined,
  windows: { online: number; idle?: number },
): { state: PresenceState; ageMs: number | null } {
  useTick();
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
  const ageMs = lastSeenMs != null ? serverNow() - lastSeenMs : null;

  let state: PresenceState;
  if (ageMs == null) state = 'never';
  else if (ageMs < windows.online) state = 'online';
  else if (windows.idle != null && ageMs < windows.idle) state = 'idle';
  else state = 'offline';

  return { state, ageMs };
}

/** Compact "n min / n h / n d" for a badge label. Reuses the `tasks.online.*` keys. */
export function shortAgo(ageMs: number, t: TFn): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return t('tasks.online.shortMinutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('tasks.online.shortHoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  return t('tasks.online.shortDaysAgo', { n: days });
}

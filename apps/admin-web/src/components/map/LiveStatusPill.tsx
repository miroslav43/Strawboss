'use client';

import { useEffect, useState } from 'react';
import type { MachineLastLocation } from '@strawboss/types';
import type { RealtimeStatus } from '@/lib/realtime';
import { useI18n } from '@/lib/i18n';

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

function fmtAgo(
  ms: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (ms < 60_000) return t('leaflet.justNow');
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return t('leaflet.minsAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('leaflet.hoursAgo', { n: hours });
  return t('leaflet.daysAgo', { n: Math.floor(hours / 24) });
}

interface LiveStatusPillProps {
  machines: MachineLastLocation[];
  realtimeStatus: RealtimeStatus;
}

/**
 * Small overlay rendered in the top-left of the admin map. Shows whether
 * realtime is connected, how long ago the most recent GPS report arrived,
 * and the live online / offline machine split.
 */
export function LiveStatusPill({ machines, realtimeStatus }: LiveStatusPillProps) {
  const { t } = useI18n();
  // Re-render every 10 s so the "12s ago" string stays fresh even without
  // a new GPS event.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 10_000);
    return () => clearInterval(id);
  }, []);

  if (machines.length === 0) return null;

  const now = Date.now();
  let latest = 0;
  let online = 0;
  for (const m of machines) {
    const ts = new Date(m.recordedAt).getTime();
    if (ts > latest) latest = ts;
    if (now - ts < ONLINE_THRESHOLD_MS) online += 1;
  }
  const offline = machines.length - online;
  const lastUpdate = latest > 0 ? fmtAgo(now - latest, t) : '—';

  const tone =
    realtimeStatus === 'connected'
      ? 'bg-green-500'
      : realtimeStatus === 'reconnecting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-red-500';

  const labelKey =
    realtimeStatus === 'connected'
      ? 'map.liveStatus.live'
      : realtimeStatus === 'reconnecting'
        ? 'map.liveStatus.reconnecting'
        : 'map.liveStatus.offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs shadow-md ring-1 ring-black/5 backdrop-blur-sm"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />
      <span className="font-semibold text-neutral-800">{t(labelKey)}</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-600">
        {t('map.liveStatus.lastUpdateAgo', { ago: lastUpdate })}
      </span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-600">
        {t('map.liveStatus.onlineCount', { n: online, off: offline })}
      </span>
    </div>
  );
}

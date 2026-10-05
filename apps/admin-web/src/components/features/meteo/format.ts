import { useMemo } from 'react';
import type { MeteoReason, MeteoStatusColor } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { ROMANIA_TZ, romaniaDateString } from '@/lib/date';

/** Reason params that are ISO timestamps and must be formatted before interpolation. */
const TIME_PARAMS = new Set(['until', 'at', 'from']);

/** Tailwind classes per traffic-light colour (row tint, dot, badge). */
export const STATUS_STYLES: Record<
  MeteoStatusColor,
  { row: string; dot: string; badge: string; hex: string }
> = {
  green: {
    row: 'bg-green-50/60',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-800',
    hex: '#16a34a',
  },
  yellow: {
    row: 'bg-amber-50/60',
    dot: 'bg-amber-400',
    badge: 'bg-amber-100 text-amber-800',
    hex: '#f59e0b',
  },
  red: {
    row: 'bg-red-50/60',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-800',
    hex: '#dc2626',
  },
  grey: {
    row: 'bg-neutral-50',
    dot: 'bg-neutral-400',
    badge: 'bg-neutral-200 text-neutral-700',
    hex: '#9ca3af',
  },
};

export const STATUS_ORDER: MeteoStatusColor[] = ['green', 'yellow', 'red', 'grey'];

/**
 * Meteo formatters, all pinned to Europe/Bucharest (the operation's clock).
 * Moisture fractions are shown as % with ONE decimal.
 */
export function useMeteoFormat() {
  const { t } = useI18n();
  const fmt = useLocaleFormat();

  return useMemo(() => {
    const tag = fmt.tag;
    const hm = new Intl.DateTimeFormat(tag, {
      timeZone: ROMANIA_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const weekday = new Intl.DateTimeFormat(tag, { timeZone: ROMANIA_TZ, weekday: 'short' });
    const dayMonth = new Intl.DateTimeFormat(tag, {
      timeZone: ROMANIA_TZ,
      day: '2-digit',
      month: '2-digit',
    });
    const axis = new Intl.DateTimeFormat(tag, {
      timeZone: ROMANIA_TZ,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const oneDecimal = new Intl.NumberFormat(tag, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    /** HH:mm, prefixed with weekday (within a week) or dd.mm when not today. */
    const time = (iso: string | null | undefined): string => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      const todayStr = romaniaDateString(new Date());
      const dayStr = romaniaDateString(d);
      if (dayStr === todayStr) return hm.format(d);
      const diffDays = Math.abs(Date.parse(`${dayStr}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86_400_000;
      const prefix = diffDays <= 6 ? weekday.format(d) : dayMonth.format(d);
      return `${prefix} ${hm.format(d)}`;
    };

    /** Fraction (0.153) -> "15.3 %". */
    const pct = (fraction: number | null | undefined): string =>
      fraction === null || fraction === undefined || !Number.isFinite(fraction)
        ? '—'
        : `${oneDecimal.format(fraction * 100)} %`;

    /** Reason -> localized sentence, ISO params formatted in Europe/Bucharest first. */
    const reasonText = (reason: MeteoReason): string => {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(reason.params ?? {})) {
        params[k] = TIME_PARAMS.has(k) && typeof v === 'string' ? time(v) : v;
      }
      return t(`meteo.reason.${reason.key}`, params);
    };

    return {
      time,
      pct,
      reasonText,
      axis: (ms: number) => axis.format(new Date(ms)),
      dateTime: (iso: string | null | undefined) =>
        iso ? fmt.dateTime.format(new Date(iso)) : '—',
      hours: (h: number | null | undefined) =>
        h === null || h === undefined ? '—' : `${oneDecimal.format(h)} h`,
    };
  }, [fmt, t]);
}

/** Local `datetime-local` input value (YYYY-MM-DDTHH:mm) for an instant, in Europe/Bucharest. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROMANIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Inverse of `toLocalInput`: a Europe/Bucharest wall-clock string -> ISO UTC. */
export function fromLocalInput(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of Bucharest at that instant: render the guess back and diff.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const back = toLocalInput(new Date(guess));
    const bm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(back);
    if (!bm) return null;
    const [by, bmo, bd, bh, bmi] = bm.slice(1).map(Number);
    guess += asUtc - Date.UTC(by, bmo - 1, bd, bh, bmi);
  }
  return new Date(guess).toISOString();
}

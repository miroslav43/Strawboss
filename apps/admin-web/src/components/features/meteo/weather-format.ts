import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { ROMANIA_TZ, romaniaDateString } from '@/lib/date';

const DASH = '—';
const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Re-renders every `everyMs` so "updated X min ago" stays honest on an open tab. */
export function useNowMs(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * Weather value formatters. Wire units are m/s, mm, °C and fractions; people
 * read km/h and percent, so the conversion lives here (m/s stays in the title).
 * Units are symbols, not words, so they need no catalog entry.
 */
export function useWeatherFormat() {
  const { t } = useI18n();
  const fmt = useLocaleFormat();

  return useMemo(() => {
    const tag = fmt.tag;
    const nf = (digits: number) =>
      new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const n0 = nf(0);
    const n1 = nf(1);
    const weekday = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', weekday: 'short' });
    const dayMonth = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
    const monthShort = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', month: 'short' });
    const hm = new Intl.DateTimeFormat(tag, {
      timeZone: ROMANIA_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    /** Local calendar date string (YYYY-MM-DD) -> a UTC-noon Date, immune to DST edges. */
    const dayDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

    return {
      n0,
      n1,
      /** 12.3 °C (digits: 0 or 1). */
      temp: (c: number | null | undefined, digits: 0 | 1 = 0) =>
        ok(c) ? `${(digits === 0 ? n0 : n1).format(c)} °C` : DASH,
      /** 12° — compact, for chips and day cards. */
      deg: (c: number | null | undefined) => (ok(c) ? `${n0.format(c)}°` : DASH),
      /** m/s -> "36 km/h". */
      kmh: (ms: number | null | undefined) => (ok(ms) ? `${n0.format(ms * 3.6)} km/h` : DASH),
      /** The exact wire value, for a tooltip. */
      ms: (ms: number | null | undefined) => (ok(ms) ? `${n1.format(ms)} m/s` : ''),
      mm: (v: number | null | undefined) => (ok(v) ? `${n1.format(v)} mm` : DASH),
      /** Fraction -> "45 %". */
      pct: (f: number | null | undefined) => (ok(f) ? `${n0.format(f * 100)} %` : DASH),
      hours: (h: number | null | undefined) => (ok(h) ? `${n1.format(h)} h` : DASH),
      /** HH:mm in Europe/Bucharest from an ISO instant. */
      clock: (iso: string | null | undefined) => {
        if (!iso) return DASH;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? DASH : hm.format(d);
      },
      /** "Mon" for a local YYYY-MM-DD. */
      weekday: (ymd: string) => weekday.format(dayDate(ymd)),
      dayMonth: (ymd: string) => dayMonth.format(dayDate(ymd)),
      isWeekend: (ymd: string) => {
        const d = dayDate(ymd).getUTCDay();
        return d === 0 || d === 6;
      },
      monthShort: (month1to12: number) => monthShort.format(new Date(Date.UTC(2021, month1to12 - 1, 15))),
      isToday: (ymd: string) => ymd === romaniaDateString(new Date()),
      /** "just now" / "12 min ago" / "3 h ago" from a past ISO instant. */
      ago: (iso: string | null | undefined, nowMs: number) => {
        if (!iso) return DASH;
        const diffMin = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
        if (diffMin < 1) return t('meteo.wx.agoNow');
        if (diffMin < 90) return t('meteo.wx.agoMin', { count: diffMin });
        return t('meteo.wx.agoHours', { count: Math.round(diffMin / 60) });
      },
      /** Signed with an explicit sign, e.g. "+1.2". */
      signed: (v: number | null | undefined, digits: 0 | 1 = 1) => {
        if (!ok(v)) return DASH;
        const s = (digits === 0 ? n0 : n1).format(v);
        return v > 0 ? `+${s}` : s;
      },
    };
  }, [fmt, t]);
}

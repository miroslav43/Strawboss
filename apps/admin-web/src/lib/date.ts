/**
 * Business-timezone date helpers.
 *
 * StrawBoss operates in Romania, so the "operational day" (which day a task
 * assignment or daily plan belongs to) must be anchored to Europe/Bucharest —
 * never to UTC. `new Date().toISOString()` derives a UTC calendar date, which
 * between 21:00–24:00 UTC reports yesterday for a Romanian user, so the admin
 * would file a task for the wrong day and it would never reach mobile.
 */

const ROMANIA_TZ = 'Europe/Bucharest';

/** Calendar date (YYYY-MM-DD) of `instant` in Romania's timezone. */
export function romaniaDateString(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROMANIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's calendar date (YYYY-MM-DD), anchored to Romania's timezone. */
export function todayInRomania(): string {
  return romaniaDateString();
}

/** Add `days` to a YYYY-MM-DD string (pure calendar arithmetic, DST-safe). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Tomorrow's calendar date (YYYY-MM-DD), anchored to Romania's timezone. */
export function tomorrowInRomania(): string {
  return addDays(todayInRomania(), 1);
}

/** Em-dash placeholder for an absent value, shared by the table label helpers. */
export const EMPTY = '—';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Render a date for display as `dd.MM.yyyy`.
 *
 * Accepts both wire shapes the API produces for a DATE column: the bare
 * `YYYY-MM-DD` string and a full ISO instant. A bare date is formatted by
 * string surgery rather than through `Date`, because `new Date('2026-07-15')`
 * parses as UTC midnight and would render as the 14th for any viewer west of
 * Greenwich.
 */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  if (BARE_DATE.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: ROMANIA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dt);
}

/** Render an instant for display as `dd.MM.yyyy HH:mm`, in Romania's timezone. */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: ROMANIA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

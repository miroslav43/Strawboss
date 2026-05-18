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

/**
 * Business-timezone date helpers.
 *
 * StrawBoss operates in Romania, so the "operational day" (which day a task
 * assignment or bale production belongs to) must be anchored to Europe/Bucharest.
 * Anchoring to the device's local time breaks if the phone's timezone is wrong;
 * the admin dashboard anchors to the same zone, so both ends always agree.
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

/** Romania's UTC offset (in minutes) at the given instant. */
function romaniaOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROMANIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour') % 24; // some engines emit 24 for midnight
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Start-of-day (00:00) for `dateStr` (YYYY-MM-DD, defaults to today) in
 * Romania's timezone, returned as a UTC ISO instant. Romania's DST switches at
 * 03:00/04:00, never at midnight, so a single offset lookup is unambiguous.
 */
export function startOfDayRomaniaISO(dateStr: string = todayInRomania()): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guessUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMin = romaniaOffsetMinutes(new Date(guessUtc));
  return new Date(guessUtc - offsetMin * 60_000).toISOString();
}

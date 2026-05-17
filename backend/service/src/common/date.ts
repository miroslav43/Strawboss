/**
 * Business-timezone date helpers.
 *
 * StrawBoss operates in Romania, so the "operational day" (which day a task
 * assignment, geofence check or trip number belongs to) must be anchored to
 * Europe/Bucharest — never to UTC and never to the server's local time.
 * Using `new Date().toISOString()` to derive a calendar date is a bug: between
 * 21:00–24:00 UTC it reports yesterday's date for a Romanian user.
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

/**
 * Thresholds for rejecting GPS noise, shared by every query that turns
 * `machine_location_events` rows into a track or a distance.
 *
 * Why these exist: the phones report a horizontal-accuracy estimate with every
 * fix and we store it faithfully in `accuracy_m` — but for a long time nothing
 * ever read it back. A Wi-Fi/cell-tower fix (Android
 * PRIORITY_BALANCED_POWER_ACCURACY, which surfaces as a suspiciously round
 * "100 m" on many devices) can land tens of kilometres from the machine, and a
 * polyline drawn straight through it invents a there-and-back leg across the
 * whole county.
 *
 * Measured on production data for one telehandler over 30 days (15 553 legs):
 * 602 legs implied > 130 km/h and every single one of them sat inside a
 * <= 15 min window, so they were not gap artefacts — 96 % of legs longer than
 * 5 km had an endpoint whose own accuracy estimate was worse than 100 m, and
 * the mean claimed error on those endpoints was 1 655 m. Dropping fixes worse
 * than ACCURACY_CAP_M removed 97 % of the impossible legs while keeping 65 % of
 * the points, and brought the month's computed distance from 4 518 km down to
 * 878 km.
 */

/** A leg implying more than this speed is noise, not travel. ≈ 130 km/h. */
export const SPEED_CAP_MS = 36;

/** A single leg longer than this is noise, not travel. 5 km. */
export const SEGMENT_CAP_M = 5000;

/**
 * A fix whose own horizontal-accuracy estimate is worse than this is a wrong
 * position, not an imprecise one — it is excluded from tracks and distances.
 *
 * Note this is deliberately NOT applied at ingest: a coarse fix is still a
 * useful answer to "roughly where is this machine", which is what presence,
 * geofencing and the loader↔truck proximity board need. It is rejected only
 * where precision is what's being asked for.
 */
export const ACCURACY_CAP_M = 100;

/**
 * No points for longer than this means the machine stopped reporting, not that
 * it travelled in a straight line. Tracks break into a new segment here rather
 * than drawing across the outage.
 *
 * 10 minutes is far above the 20–30 s reporting cadence, so normal operation is
 * never fragmented; in the 30-day sample only 55 gaps exceeded 5 minutes.
 */
export const GAP_SPLIT_S = 600;

/**
 * Largest value `machine_location_events.accuracy_m` can hold, per migration
 * 00095 which widened it to NUMERIC(9,2).
 *
 * This bound is load-bearing, not cosmetic. The column started as NUMERIC(6,2)
 * — ceiling 9999.99 — and production had already recorded a 9906.20 m fix. One
 * fix at 10 km would have raised a numeric-overflow, turning the insert into a
 * 500; the mobile outbox treats any 5xx as transient and re-posts the same
 * batch forever, which is exactly the retry storm commit 5a38ed8 had to put
 * down once already.
 */
export const ACCURACY_COLUMN_MAX_M = 9_999_999.99;

/**
 * Coerce a client-supplied accuracy into something the column can store.
 * Non-finite and negative values become null rather than poisoning the row —
 * an unknown error estimate is honest, a fabricated one is not.
 */
export function clampAccuracyM(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(value, ACCURACY_COLUMN_MAX_M);
}

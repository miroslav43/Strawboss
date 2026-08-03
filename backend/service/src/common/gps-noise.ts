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
 * Accuracy ceiling for DISTANCE totals only. Not applied to tracks — see below.
 *
 * Distance is a sum, so it is vulnerable to something a drawn line is not:
 * jitter. A parked machine whose fixes wander ±30 m contributes real metres to
 * every leg, thousands of times a day, and neither the speed nor the leg cap
 * notices because 30 m in 20 s is a perfectly legal 5 km/h. Gating on accuracy
 * is what stops a stationary loader from "driving" 90 km/day.
 *
 * Deliberately NOT applied at ingest either: a coarse fix is still a useful
 * answer to "roughly where is this machine", which is what presence, geofencing
 * and the loader↔truck proximity board need.
 */
export const ACCURACY_CAP_M = 100;

/**
 * A single point that leaves the path and comes straight back is a GPS
 * excursion, not a detour — drop it.
 *
 * This catches what the speed and leg caps structurally cannot. A fix that
 * lands 4 km away 3 minutes after the last one implies 80 km/h, which is
 * entirely legal, and the fix after it returns to the route at another legal
 * speed. Both legs pass every per-leg test; only the SHAPE gives it away.
 * Measured on ten days of one machine: 65 such excursions out of 14 171 points
 * (0.46%), together fabricating 102 km of travel.
 *
 * The test is `(out + back) > ratio × direct`, i.e. going via this point is
 * more than three times longer than skipping it. Accuracy was evaluated as an
 * additional condition and rejected: it catches under half of them (28/65 at
 * >300 m) while implicating 2 844 perfectly good points. Geometry is the
 * precise instrument here; the device's own error estimate is not.
 */
export const SPIKE_DETOUR_RATIO = 3;

/** Excursions shorter than this are ordinary jitter, not spikes. */
export const SPIKE_MIN_EXCURSION_M = 300;

/**
 * Never despike across sparse capture. With minutes between fixes the machine
 * really could have gone somewhere and come back, so the shape stops being
 * evidence. Every excursion measured in practice sat well inside this.
 */
export const SPIKE_MAX_LEG_S = 180;

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
 * Speed cap for machines that physically cannot go fast (loader / telehandler /
 * baler — anything but a truck). ≈ 54 km/h.
 *
 * Why the global SPEED_CAP_MS is not enough for them: the residual "spider web"
 * after the first fix was cell-tower fixes arriving at the 60 s presence
 * cadence with occasional missed beats — a 4 km hop over 122 s is 33 m/s,
 * i.e. a perfectly legal 118 km/h under the truck-calibrated cap, but no
 * telehandler on earth does that. Measured over 7 days of fleet data: of ALL
 * non-truck legs longer than {@link SLOW_MACHINE_MIN_LEG_M} at over this speed
 * (595 on one loader alone), exactly ZERO had a trusted GPS fix on both ends —
 * there are no trailer transports in the data; every single one is network-fix
 * noise.
 */
export const SLOW_MACHINE_SPEED_CAP_MS = 15;

/**
 * The slow-machine cap only applies to legs longer than this. On short legs
 * jitter fakes speed (a 45 m wobble over 3 s reads as 15 m/s on a parked
 * baler); above ~800 m at slow-machine speeds jitter cannot reach, so the test
 * discriminates cleanly.
 */
export const SLOW_MACHINE_MIN_LEG_M = 800;

/**
 * A fix better than this is a real GNSS fix and anchors the "skeleton" the
 * consistency filter trusts (see route-cleaning.ts). At/above it sits the
 * network-fix regime: Android reports fused Wi-Fi/cell positions with a
 * suspiciously round 100/300/500 label, and those can land kilometres away.
 *
 * CAUTION — this is a SKELETON-MEMBERSHIP threshold, not a drop gate. Dropping
 * every >=100 m point outright was measured TWICE and failed twice: on healthy
 * streams it deletes a third of the day for zero cleanliness gain, and on sick
 * streams deleting the mid-accuracy anchors RE-EXPOSES big legs the kinematic
 * chain was suppressing (11 → 19 drawn km-scale legs in the A/B run).
 */
export const GPS_TRUSTED_ACCURACY_M = 100;

/**
 * A network fix with no trusted skeleton fix within this window (either side)
 * is presence data — the phone's location task was dead and only the 60 s
 * check-in fallback was reporting (last-known + Balanced, see mobile
 * getBestEffortPosition). Cell-tower hops in that regime fabricate travel;
 * with no skeleton to judge them against, the honest answer is no track.
 */
export const SKELETON_WINDOW_S = 600;

/** Minimum distance-from-skeleton tolerance before a network fix is rejected. */
export const SKELETON_TOLERANCE_FLOOR_M = 500;

/**
 * Tolerance ceiling: 2×accuracy, but capped — a fix claiming 3.7 km of error
 * must not buy itself a 7.4 km leash. Between FLOOR and CAP the tolerance
 * scales with the fix's own honesty.
 */
export const SKELETON_TOLERANCE_CAP_M = 1000;

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

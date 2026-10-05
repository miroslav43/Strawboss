/**
 * Coerce an untrusted numeric query param into a sane bound.
 *
 * Neither `GET /trips` nor `GET /trip-requests` has a zod query schema — every
 * filter on them is a plain optional string — so the bound is enforced here
 * instead. `Number('abc')` is NaN and `Number('')` is 0, both of which would
 * otherwise reach a `LIMIT`/`OFFSET`; NaN falls back and 0 is clamped by the
 * caller's `min`.
 */
export function clampInt(
  value: number | undefined,
  fallback: number,
  max: number,
  min = 0,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

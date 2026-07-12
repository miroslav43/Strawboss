/**
 * Client↔server clock offset, so presence staleness is measured against SERVER
 * time, not the viewer's browser clock.
 *
 * Every presence dot computes `now - lastSeen < window`. If it uses the admin
 * PC's `Date.now()` and that clock runs fast, every dot dims early even though
 * devices are reporting fine. `ApiClient.request()` feeds this module the `Date`
 * response header on every call, so the offset self-corrects continuously; the
 * dots then use `serverNow()` instead of `Date.now()`.
 *
 * The `Date` header is a standard response header set by nginx on the same
 * NTP-synced VM as Postgres, so it matches the `NOW()` timestamps the dots
 * compare against. (For a CROSS-origin API deployment the server would need
 * `Access-Control-Expose-Headers: Date`; StrawBoss serves admin-web and the API
 * from the same origin, so it's visible. If it ever isn't, the offset stays 0 —
 * i.e. we silently fall back to today's browser-clock behaviour.)
 */

/**
 * Ignore offsets larger than this. A value this big means a broken clock (or a
 * bogus proxy `Date`), not the sub-minute skew we correct for — clamping to 0
 * keeps a wildly-wrong clock from making every device read permanently offline.
 */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000;

let offsetMs = 0;

/**
 * Update the offset (server time − client time). Implausibly large values are
 * ignored (kept at the last good offset / 0).
 */
export function setServerClockOffset(candidateOffsetMs: number): void {
  if (!Number.isFinite(candidateOffsetMs)) return;
  if (Math.abs(candidateOffsetMs) > MAX_PLAUSIBLE_OFFSET_MS) return;
  offsetMs = candidateOffsetMs;
}

/** Best estimate of the server's current wall-clock time, in ms since epoch. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Current offset (server − client) in ms. Exposed for tests / diagnostics. */
export function getServerClockOffset(): number {
  return offsetMs;
}

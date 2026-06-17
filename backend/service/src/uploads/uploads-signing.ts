import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived HMAC signing for `/api/v1/uploads/...` URLs.
 *
 * The static file route lives OUTSIDE NestJS routing (registered directly on
 * Fastify), so the AuthGuard never runs for it. Instead of leaving uploaded
 * signatures / receipts / avatars world-readable, every upload URL is signed at
 * response egress (UploadUrlSigningInterceptor) and the static route verifies
 * the signature on each GET (Fastify onRequest hook in main.ts). This works with
 * plain `<img src>` (no Authorization header needed) for both admin-web and the
 * mobile app, which just consume the pre-signed URL the API returned.
 */

export const UPLOADS_URL_PREFIX = '/api/v1/uploads/';

/** Default validity window of a signed URL. */
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
/**
 * Expiry granularity. `exp` is rounded UP to this bucket so the SAME asset gets
 * a STABLE signed URL within the window — browser / RN image caches stay warm
 * instead of re-downloading on every API fetch (which re-signs the field).
 */
const BUCKET_SEC = 60 * 60; // 1 hour

function computeSig(pathname: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${pathname}\n${exp}`).digest('hex');
}

/** Whether `url` is an uploads URL that should be signed / verified. */
export function isUploadUrl(url: string): boolean {
  return url.startsWith(UPLOADS_URL_PREFIX);
}

/**
 * Append a short-lived `exp`/`sig` to an uploads URL. Idempotent — any existing
 * exp/sig are stripped before re-signing, and other query params (e.g. the
 * `?v=` cache-buster) are preserved. Non-upload URLs are returned unchanged.
 */
export function signUploadUrl(
  url: string,
  secret: string,
  nowMs: number,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  if (!isUploadUrl(url)) return url;
  const [pathname, rawQuery = ''] = url.split('?');
  const params = new URLSearchParams(rawQuery);
  params.delete('exp');
  params.delete('sig');
  const nowSec = Math.floor(nowMs / 1000);
  const exp = Math.ceil(nowSec / BUCKET_SEC) * BUCKET_SEC + ttlSec;
  params.set('exp', String(exp));
  params.set('sig', computeSig(pathname, exp, secret));
  return `${pathname}?${params.toString()}`;
}

/**
 * Verify the `exp`/`sig` of an incoming uploads request against its path.
 * Returns true only when the signature matches and has not expired.
 */
export function verifyUploadSignature(
  pathname: string,
  exp: string | undefined | null,
  sig: string | undefined | null,
  secret: string,
  nowMs: number,
): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return false;
  if (expNum * 1000 < nowMs) return false;
  const expected = computeSig(pathname, expNum, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

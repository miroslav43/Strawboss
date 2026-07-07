import { z } from 'zod';

/**
 * Allowlist for signature / signature-specimen URL values. Two shapes are
 * accepted:
 *   1. An internal upload served by this backend —
 *      `/api/v1/uploads/signatures/<id>.<ext>` or
 *      `/api/v1/uploads/specimens/<id>.<ext>` (optionally with a `?v=`
 *      cache-buster, as returned by `UploadsService.saveSpecimen`).
 *   2. An inline base64 PNG/JPEG data URL, e.g.
 *      `data:image/png;base64,...` — mirrors the pattern
 *      `CmrService.SIGNATURE_URL_PATTERN` independently re-checks before
 *      embedding a signature into a generated CMR PDF.
 *
 * Anything else — in particular any `http(s)://` or `file://` URL — is
 * rejected so a signature field can never be used to smuggle an external
 * link into an `<img src>` (SSRF / stored-content risk).
 */
export const SIGNATURE_URL_PATTERN =
  /^(?:\/api\/v1\/uploads\/(?:signatures|specimens)\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)(?:\?v=\d+)?|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+)$/;

export const signatureUrlSchema = z.string().regex(SIGNATURE_URL_PATTERN, 'Invalid signature URL');

import * as FileSystem from 'expo-file-system/legacy';
import { mobileApiClient } from './api-client';
import { mobileLogger } from './logger';

/**
 * Upload a signature PNG to the server's binary signature endpoint.
 *
 * The signature comes from `SignatureCapture` as a base64-encoded PNG string
 * (data URI or raw base64).  We write it to a temporary file so we can POST it
 * as multipart/form-data to `POST /api/v1/uploads/signature`, which returns a
 * server-side URL.  The temporary file is removed afterwards.
 *
 * Returns the server URL string, e.g.
 *   `/api/v1/uploads/signatures/<uuid>.png`
 *
 * Throws on network / server errors so the caller can fall back to the
 * raw base64 string (backward-compatible with the backend's base64 acceptance).
 */

interface SignatureUploadResponse {
  url: string;
}

/**
 * Extract a pure base64 string, handling both data-URI and raw base64 input.
 * `SignatureCapture` may return `data:image/png;base64,<data>` or just `<data>`.
 */
function extractBase64(signatureInput: string): string {
  const prefix = 'base64,';
  const idx = signatureInput.indexOf(prefix);
  return idx !== -1 ? signatureInput.slice(idx + prefix.length) : signatureInput;
}

/**
 * Upload a base64 PNG signature string as a binary multipart file.
 *
 * @param signatureBase64 - Raw base64 string or data-URI from `SignatureCapture`.
 * @param kind            - 'driver' | 'receiver' — informational, sent as form field.
 * @returns Server-side URL for the uploaded signature.
 */
export async function uploadSignature(
  signatureBase64: string,
  kind: 'driver' | 'receiver' = 'driver',
): Promise<string> {
  const base64Data = extractBase64(signatureBase64);

  // Write the raw base64 to a temporary local PNG file so FormData can
  // attach it as a file part (React Native FormData does not accept raw
  // base64 directly for binary uploads).
  const tmpUri =
    (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '') +
    `signature-${Date.now()}.png`;

  await FileSystem.writeAsStringAsync(tmpUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  try {
    const form = new FormData();
    form.append('kind', kind);
    // React Native FormData accepts this object shape for file attachments —
    // we cast to `any` to avoid the cross-platform TS mismatch (same pattern
    // used in receiptUpload.ts).
    form.append('file', {
      uri: tmpUri,
      name: `signature-${kind}-${Date.now()}.png`,
      type: 'image/png',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const response = await mobileApiClient.upload<SignatureUploadResponse>(
      '/api/v1/uploads/signature',
      form,
    );

    mobileLogger.flow('Signature uploaded as binary', {
      kind,
      url: response.url,
    });

    return response.url;
  } catch (err) {
    mobileLogger.error('Signature binary upload failed', {
      kind,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Best-effort cleanup — ignore errors if the file was already removed.
    FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}

interface SpecimenUploadResponse {
  signatureSpecimenUrl: string | null;
}

/**
 * Upload the user's signature specimen as a binary multipart file.
 *
 * Mirrors `uploadSignature` but POSTs to `/api/v1/profile/specimen`, which
 * writes a canonical `uploads/specimens/{userId}.png` and updates the user
 * row. Returns the canonical URL the server stored on the user.
 *
 * @param signatureBase64 - Raw base64 string or data-URI from `SignatureCapture`.
 * @returns Server-side specimen URL.
 */
export async function uploadSpecimen(signatureBase64: string): Promise<string> {
  const base64Data = extractBase64(signatureBase64);

  const tmpUri =
    (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '') +
    `specimen-${Date.now()}.png`;

  await FileSystem.writeAsStringAsync(tmpUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  try {
    const form = new FormData();
    form.append('file', {
      uri: tmpUri,
      name: `specimen-${Date.now()}.png`,
      type: 'image/png',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // The backend returns the full updated user; we only need the URL.
    const response = await mobileApiClient.upload<SpecimenUploadResponse>(
      '/api/v1/profile/specimen',
      form,
    );

    if (!response.signatureSpecimenUrl) {
      throw new Error('Server did not return a specimen URL');
    }

    mobileLogger.flow('Signature specimen uploaded', { url: response.signatureSpecimenUrl });
    return response.signatureSpecimenUrl;
  } catch (err) {
    mobileLogger.error('Specimen upload failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}

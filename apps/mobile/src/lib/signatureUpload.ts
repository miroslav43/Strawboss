import * as FileSystem from 'expo-file-system/legacy';
import { mobileApiClient } from './api-client';
import { mobileLogger } from './logger';

/**
 * Extract a pure base64 string, handling both data-URI and raw base64 input.
 * `SignatureCapture` may return `data:image/png;base64,<data>` or just `<data>`.
 */
function extractBase64(signatureInput: string): string {
  const prefix = 'base64,';
  const idx = signatureInput.indexOf(prefix);
  return idx !== -1 ? signatureInput.slice(idx + prefix.length) : signatureInput;
}

interface SpecimenUploadResponse {
  signatureSpecimenUrl: string | null;
}

/**
 * Upload the user's signature specimen as a binary multipart file, POSTing to
 * `/api/v1/profile/specimen`, which writes a canonical
 * `uploads/specimens/{userId}.png` and updates the user row. Returns the
 * canonical URL the server stored on the user.
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
      // A photo over a weak field connection needs more than the default 15s.
      { timeoutMs: 120_000 },
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

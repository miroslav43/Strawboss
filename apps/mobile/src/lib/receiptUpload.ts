import * as ImageManipulator from 'expo-image-manipulator';
import { mobileApiClient } from './api-client';
import { mobileLogger } from './logger';

/**
 * Compress + upload a receipt photo captured locally by the operator.
 *
 * Pipeline:
 *   localUri (original camera frame, usually ~2-5 MB JPEG)
 *     -> resize to max 1280 px wide (preserves aspect ratio)
 *     -> re-encode as WebP at quality 0.7
 *     -> POST multipart/form-data to /api/v1/uploads/receipt
 *
 * The resulting file on the server is typically ~80-200 KB.
 */

/** Longest edge (px) we keep. Receipts are legible well below 1280 px wide. */
const MAX_WIDTH = 1280;
const WEBP_QUALITY = 0.7;

interface CompressResult {
  uri: string;
  width: number;
  height: number;
}

interface UploadResponse {
  url: string;
  key: string;
  sizeBytes: number;
}

/** Resize + re-encode to WebP. Returns the new local file URI. */
export async function compressReceipt(sourceUri: string): Promise<CompressResult> {
  const result = await ImageManipulator.manipulateAsync(
    sourceUri,
    // `resize` with only `width` keeps aspect ratio automatically; if the
    // source is already narrower than MAX_WIDTH, the native implementation
    // treats this as a no-op (the image is just re-encoded).
    [{ resize: { width: MAX_WIDTH } }],
    {
      compress: WEBP_QUALITY,
      format: ImageManipulator.SaveFormat.WEBP,
    },
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Compress `sourceUri` and upload it. Throws on network / server errors so
 * the caller can fall back to queueing the raw URI for a later retry.
 */
export async function uploadReceipt(
  sourceUri: string,
  kind: 'fuel' | 'consumable' = 'fuel',
): Promise<UploadResponse> {
  const compressed = await compressReceipt(sourceUri);

  const form = new FormData();
  form.append('kind', kind);
  // React Native's FormData accepts this shape for file parts even though
  // the cross-platform TS types don't model it — we cast to `any` to avoid
  // bringing in a custom blob polyfill just for this one call site.
  form.append('file', {
    uri: compressed.uri,
    name: `receipt-${Date.now()}.webp`,
    type: 'image/webp',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  try {
    const response = await mobileApiClient.upload<UploadResponse>(
      '/api/v1/uploads/receipt',
      form,
    );
    mobileLogger.flow('Receipt uploaded', {
      kind,
      url: response.url,
      sizeBytes: response.sizeBytes,
    });
    return response;
  } catch (err) {
    mobileLogger.error('Receipt upload failed', {
      kind,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

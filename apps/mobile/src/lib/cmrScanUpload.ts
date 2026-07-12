import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { mobileApiClient } from './api-client';
import { mobileLogger } from './logger';
import { generateUuid } from './uuid';
import { getDatabase } from './storage';
import { SyncQueueRepo } from '@/db/sync-queue-repo';

/**
 * The scanned paper CMR — the physical transport document the external driver
 * brings, which the loader photographs at the end of an auxiliary load.
 *
 * Pipeline:
 *   document scanner (see cmrScanner.ts — auto corner detection + crop)
 *     -> 1..N cropped page images
 *     -> downscale + JPEG re-encode each page
 *     -> one paginated A4 PDF, built on-device (works offline)
 *     -> POST multipart/form-data to /api/v1/cmr-scans/trip/:tripId
 *
 * Everything up to the POST is offline-safe, which is what lets the load flow
 * treat the scan as mandatory: the loader can always finish, and the PDF drains
 * from the sync queue whenever signal comes back.
 *
 * Deliberately does NOT import the scanner: the sync queue drains PDFs through
 * here, and must keep working even on a device where the ML Kit native module
 * can't load. Capture lives in cmrScanner.ts, which only the load screen imports.
 */

/**
 * Downscale before base64-encoding. A raw 12 MP page is ~8 MB, and expo-print
 * renders the HTML in a WebView — inlining several of those as base64 data URIs
 * reliably OOMs the WebView on a low-end fleet phone. 1600 px keeps a CMR legible
 * (it is a form, not fine print) at a fraction of the size.
 */
const PAGE_MAX_WIDTH = 1600;
const PAGE_JPEG_QUALITY = 0.7;

/** A4 at 72 dpi, in points — what expo-print expects. */
const A4_WIDTH_PT = 595;
const A4_HEIGHT_PT = 842;

/** Where finished PDFs wait for signal. NOT the cache dir — see buildCmrPdf(). */
const PDF_DIR = `${FileSystem.documentDirectory}cmr-scans/`;

interface UploadResponse {
  id: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
}

/**
 * Render the scanned pages into a single paginated A4 PDF, on-device.
 *
 * The PDF is moved out of the cache directory into documentDirectory: expo-print
 * writes to cache, and Android evicts cache under storage pressure — a scan queued
 * offline can sit for days waiting for signal, and would otherwise be gone by then.
 */
export async function buildCmrPdf(
  imageUris: string[],
  tripId: string,
): Promise<{ uri: string; pageCount: number; scanId: string }> {
  if (imageUris.length === 0) {
    throw new Error('buildCmrPdf: no pages to render');
  }

  const pages: string[] = [];
  // manipulateAsync ALWAYS writes the processed image to disk, even though we
  // only consume its base64 — track those copies so we can reclaim the space.
  const intermediates: string[] = [];
  for (const uri of imageUris) {
    const compressed = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: PAGE_MAX_WIDTH } }],
      {
        compress: PAGE_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (compressed.uri) {
      intermediates.push(compressed.uri);
    }
    if (compressed.base64) {
      pages.push(`data:image/jpeg;base64,${compressed.base64}`);
    }
  }

  // The bytes are now inlined into the PDF HTML below, so the on-disk processed
  // copies are dead weight whether we succeed or throw on the next line.
  await deleteLocalCmrImages(intermediates);

  if (pages.length === 0) {
    throw new Error('buildCmrPdf: every page failed to encode');
  }

  // `break-after` is the modern property, `page-break-after` the one the Android
  // WebView print path actually honours — set both. The :last-child reset is what
  // stops the PDF ending on a blank page.
  const html = `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          @page { size: A4; margin: 0; }
          html, body { margin: 0; padding: 0; }
          .page {
            width: 100%;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            page-break-after: always;
            break-after: page;
          }
          .page:last-child { page-break-after: auto; break-after: auto; }
          .page img { max-width: 100%; max-height: 100%; object-fit: contain; }
        </style>
      </head>
      <body>
        ${pages.map((src) => `<div class="page"><img src="${src}" /></div>`).join('')}
      </body>
    </html>`;

  const printed = await Print.printToFileAsync({
    html,
    width: A4_WIDTH_PT,
    height: A4_HEIGHT_PT,
  });

  await FileSystem.makeDirectoryAsync(PDF_DIR, { intermediates: true }).catch(() => {
    /* already exists */
  });
  // A stable id minted once here and reused across every upload attempt for this
  // PDF — the server keys the storage filename on it, so an ambiguous-failure
  // retry overwrites the same blob instead of orphaning one on disk.
  const scanId = generateUuid();
  const destination = `${PDF_DIR}${tripId}-${scanId}.pdf`;
  await FileSystem.moveAsync({ from: printed.uri, to: destination });

  mobileLogger.flow('CMR scan PDF built', { tripId, pageCount: pages.length });
  return { uri: destination, pageCount: pages.length, scanId };
}

/**
 * Upload a finished CMR PDF against its trip. Throws on network/server errors so
 * the caller can queue the local URI for a later retry.
 */
export async function uploadCmrScan(
  tripId: string,
  localPdfUri: string,
  pageCount?: number,
  scanId?: string,
): Promise<UploadResponse> {
  const form = new FormData();
  // Must come BEFORE the file part: the server reads multipart fields off the
  // streaming parser, which only sees what arrived ahead of the file.
  if (pageCount != null) {
    form.append('pageCount', String(pageCount));
  }
  if (scanId != null) {
    form.append('scanId', scanId);
  }
  // React Native's FormData accepts this shape for file parts even though the
  // cross-platform TS types don't model it — same cast as receiptUpload.ts.
  form.append('file', {
    uri: localPdfUri,
    name: `cmr-${tripId}.pdf`,
    type: 'application/pdf',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  try {
    const response = await mobileApiClient.upload<UploadResponse>(
      `/api/v1/cmr-scans/trip/${tripId}`,
      form,
    );
    // Log the document id, never the fileUrl — that URL carries a signed token,
    // and logs get persisted to disk and uploaded.
    mobileLogger.flow('CMR scan uploaded', {
      tripId,
      documentId: response.id,
      sizeBytes: response.fileSizeBytes,
    });
    return response;
  } catch (err) {
    mobileLogger.error('CMR scan upload failed', {
      tripId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Best-effort cleanup once a scan is safely on the server. */
export async function deleteLocalCmrPdf(localPdfUri: string): Promise<void> {
  await FileSystem.deleteAsync(localPdfUri, { idempotent: true }).catch(() => {
    /* already gone */
  });
}

/**
 * Best-effort delete of scan images — the captured source pages and the
 * intermediate processed copies ImageManipulator leaves on disk. Called once the
 * pages are captured in the PDF; otherwise every load strands a stack of
 * transport-document photos (driver name, plates, signatures) in app storage
 * forever, on phones that hold zero-to-many loads a day.
 */
export async function deleteLocalCmrImages(uris: string[]): Promise<void> {
  await Promise.all(
    uris.map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {
        /* already gone */
      }),
    ),
  );
}

/**
 * What a queued `cmr_scan` entry carries. The PDF itself stays on the filesystem —
 * sync_queue.payload is a TEXT column holding JSON and cannot hold binary, so we
 * queue the path and let the sender read the file at push time (the same shape the
 * receipt uploads use).
 */
export interface CmrScanPayload {
  tripId: string;
  localPdfUri: string;
  pageCount: number;
  /** Stable storage id minted at build time, so upload retries overwrite one blob. */
  scanId?: string;
  /** The sibling register_load's idempotency key, so push.ts can defer if it failed. */
  registerLoadIdempotencyKey?: string;
}

/** Queue a built PDF for upload once there's signal. */
export async function enqueueCmrScan(
  tripId: string,
  cmr: { uri: string; pageCount: number; scanId: string },
  registerLoadIdempotencyKey?: string,
): Promise<void> {
  const payload: CmrScanPayload = {
    tripId,
    localPdfUri: cmr.uri,
    pageCount: cmr.pageCount,
    scanId: cmr.scanId,
    registerLoadIdempotencyKey,
  };

  const db = await getDatabase();
  const queue = new SyncQueueRepo(db);
  const id = generateUuid();
  await queue.enqueue({
    entityType: 'cmr_scan',
    // Must be UUID-shaped: markInvalidUuidsAsFailed() culls anything else on the
    // next sync cycle, and the entry would vanish without ever being sent.
    entityId: id,
    // Must be one of insert|update|delete — sync_queue has a CHECK constraint and
    // SQLite enforces it, so an invalid action makes enqueue() throw.
    action: 'insert',
    payload,
    idempotencyKey: `cmr_scan_${id}`,
  });

  mobileLogger.flow('CMR scan queued for upload', { tripId, pageCount: cmr.pageCount });
}

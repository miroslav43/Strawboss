import * as ImagePicker from 'expo-image-picker';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import { mobileLogger } from './logger';

/**
 * Page capture for the CMR scan — the Google ML Kit document scanner (live edge
 * detection, draggable corners, auto-crop), with a plain camera fallback.
 *
 * Kept apart from cmrScanUpload.ts on purpose: this is the only file that touches
 * the scanner's native module, so the offline sync queue can drain already-built
 * PDFs on a device where that module can't load.
 */

/** Max pages in one CMR. A paper CMR runs to a handful of copies; 10 is generous. */
const MAX_PAGES = 10;
/** Quality of the crop ML Kit hands back (0-100). */
const SCAN_QUALITY = 80;

/**
 * The ML Kit scanner module isn't available — most often because Play Services
 * hasn't downloaded it yet and the phone is offline (see withMlKitDocScanner.js).
 * The caller is expected to fall back to a plain camera capture rather than
 * trapping the operator in a field with a load they can't register.
 */
export class ScannerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ScannerUnavailableError';
  }
}

/**
 * Open the document scanner. Returns the cropped page images, or an empty array
 * if the operator backed out. Throws ScannerUnavailableError if the scanner
 * itself can't run.
 */
export async function scanCmrPages(): Promise<string[]> {
  let result;
  try {
    result = await DocumentScanner.scanDocument({
      maxNumDocuments: MAX_PAGES,
      croppedImageQuality: SCAN_QUALITY,
      responseType: ResponseType.ImageFilePath,
    });
  } catch (err) {
    mobileLogger.error('CMR document scanner unavailable', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw new ScannerUnavailableError(err);
  }
  return result?.scannedImages ?? [];
}

/**
 * Fallback capture: a plain camera shot, no edge detection or crop. Used only
 * when the document scanner can't run. Returns null if the operator cancelled.
 */
export async function captureCmrPageWithCamera(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
  });
  if (result.canceled) return null;
  return result.assets[0]?.uri ?? null;
}

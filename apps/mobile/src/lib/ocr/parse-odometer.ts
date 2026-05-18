import type { OcrText } from './text-recognition';

export interface OdometerData {
  km?: number;
}

/**
 * Extract an odometer reading from a dashboard photo.
 *
 * Picks the longest run of digits (4–7 digits is typical for total km),
 * which discards shorter trip-meter values. Grouped digits ("123 456") may be
 * read as separate tokens — the field stays editable so the operator corrects.
 */
export function parseOdometer(ocr: OcrText): OdometerData {
  const groups = ocr.rawText.match(/\d+/g) ?? [];

  let best: string | undefined;
  for (const g of groups) {
    if (g.length < 4 || g.length > 7) continue;
    if (!best || g.length > best.length) best = g;
  }
  if (!best) return {};

  const km = parseInt(best, 10);
  if (!Number.isFinite(km) || km < 0 || km > 9_999_999) return {};
  return { km };
}

import { useState, useCallback } from 'react';
import { recognizeText } from './text-recognition';
import { parseFuelReceipt, parseConsumableQuantity } from './parse-receipt';
import { parseOdometer } from './parse-odometer';
import { mobileLogger } from '@/lib/logger';

export type OcrMode = 'fuel' | 'consumable' | 'odometer';

/** Flat suggestion — the caller reads the field relevant to its mode. */
export interface OcrSuggestion {
  liters?: number;
  quantity?: number;
  km?: number;
  totalCost?: number;
  unitPrice?: number;
}

/**
 * Extended scan result that includes OCR quality feedback (FM-18).
 * `ocrFailed` is true when the image was processed but no text could be read
 * (empty text, blurry photo, wrong side of receipt, etc.).
 */
export interface OcrScanResult {
  suggestion: OcrSuggestion;
  /** True when recognizeText returned no text lines — prompt the user to enter manually. */
  ocrFailed: boolean;
}

/**
 * Runs on-device OCR on a captured photo and parses it for the given mode.
 * `scanning` drives a "reading photo…" indicator. Never throws.
 *
 * FM-18: returns `ocrFailed: true` when the image yields no recognisable text,
 * so callers can show a "Nu am putut citi bonul. Introdu manual." message.
 */
export function useOcrScan() {
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async (uri: string, mode: OcrMode): Promise<OcrScanResult> => {
    setScanning(true);
    try {
      const ocr = await recognizeText(uri);
      const ocrFailed = ocr.lines.length === 0;

      let suggestion: OcrSuggestion;
      if (ocrFailed) {
        suggestion = {};
      } else if (mode === 'fuel') {
        suggestion = parseFuelReceipt(ocr);
      } else if (mode === 'consumable') {
        suggestion = parseConsumableQuantity(ocr);
      } else {
        suggestion = parseOdometer(ocr);
      }

      mobileLogger.flow('OCR scan complete', { mode, suggestion, ocrFailed });
      return { suggestion, ocrFailed };
    } finally {
      setScanning(false);
    }
  }, []);

  return { scanning, scan };
}

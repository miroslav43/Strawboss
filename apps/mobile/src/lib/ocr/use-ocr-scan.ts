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
 * Runs on-device OCR on a captured photo and parses it for the given mode.
 * `scanning` drives a "reading photo…" indicator. Never throws.
 */
export function useOcrScan() {
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async (uri: string, mode: OcrMode): Promise<OcrSuggestion> => {
    setScanning(true);
    try {
      const ocr = await recognizeText(uri);
      let suggestion: OcrSuggestion;
      if (mode === 'fuel') {
        suggestion = parseFuelReceipt(ocr);
      } else if (mode === 'consumable') {
        suggestion = parseConsumableQuantity(ocr);
      } else {
        suggestion = parseOdometer(ocr);
      }
      mobileLogger.flow('OCR scan complete', { mode, suggestion });
      return suggestion;
    } finally {
      setScanning(false);
    }
  }, []);

  return { scanning, scan };
}

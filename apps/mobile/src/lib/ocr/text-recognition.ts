import TextRecognition from '@react-native-ml-kit/text-recognition';
import { mobileLogger } from '@/lib/logger';

export interface OcrText {
  /** Full recognized text. */
  rawText: string;
  /** Recognized text split into individual non-empty lines. */
  lines: string[];
}

const EMPTY: OcrText = { rawText: '', lines: [] };

/**
 * Run on-device OCR (Google ML Kit) on a local image URI.
 *
 * Never throws — on any failure (native module unavailable, unreadable image)
 * it returns empty text so the caller silently falls back to manual entry.
 */
export async function recognizeText(uri: string): Promise<OcrText> {
  try {
    const result = await TextRecognition.recognize(uri);
    const lines: string[] = [];
    for (const block of result.blocks) {
      for (const line of block.lines) {
        const t = line.text.trim();
        if (t) lines.push(t);
      }
    }
    return { rawText: result.text ?? '', lines };
  } catch (err) {
    mobileLogger.error('OCR: recognizeText failed', {
      err: err instanceof Error ? { message: err.message } : err,
    });
    return EMPTY;
  }
}

import type { OcrText } from './text-recognition';

export interface FuelReceiptData {
  liters?: number;
  totalCost?: number;
  unitPrice?: number;
}

export interface ConsumableReceiptData {
  quantity?: number;
}

/** All number tokens in a string. Handles both `,` and `.` decimal separators. */
function numbersIn(text: string): number[] {
  const tokens = text.match(/\d{1,7}(?:[.,]\d{1,3})?/g) ?? [];
  return tokens.map((t) => parseFloat(t.replace(',', '.'))).filter((n) => Number.isFinite(n));
}

const FUEL_KEYWORDS = /MOTORIN|DIESEL|BENZIN|CARBURANT/i;
const QTY_KEYWORDS = /\b(CANT|CANTITATE|LITRI|LITRU)\b/i;
const TOTAL_KEYWORDS = /TOTAL|VALOARE|DE PLATA/i;
const PRICE_KEYWORDS = /\bPRET\b/i;

/** A fuel fill is realistically between a few and a few hundred litres. */
function plausibleLiters(n: number): boolean {
  return n >= 3 && n <= 600;
}

/**
 * Heuristic parser for a Romanian fuel receipt (OMV / Petrom / Rompetrol / MOL).
 * Returns only the fields it can find with reasonable confidence — never guesses.
 */
export function parseFuelReceipt(ocr: OcrText): FuelReceiptData {
  const data: FuelReceiptData = {};

  // 1. Litres — strongest signal: a number directly followed by "L" (a unit),
  //    excluding "LEI" where the L is followed by a letter.
  const litersCandidates: number[] = [];
  for (const match of ocr.rawText.matchAll(/(\d{1,3}(?:[.,]\d{1,3})?)\s*L(?![A-Za-z])/gi)) {
    const n = parseFloat(match[1].replace(',', '.'));
    if (plausibleLiters(n)) litersCandidates.push(n);
  }

  // 2. Litres — fallback: numbers on a line mentioning a quantity/fuel keyword.
  for (const line of ocr.lines) {
    if (QTY_KEYWORDS.test(line) || FUEL_KEYWORDS.test(line)) {
      for (const n of numbersIn(line)) {
        if (plausibleLiters(n)) litersCandidates.push(n);
      }
    }
  }

  // Real fuel quantities almost always carry decimals — prefer those.
  const withDecimals = litersCandidates.filter((n) => !Number.isInteger(n));
  data.liters = withDecimals[0] ?? litersCandidates[0];

  // 3. Total cost — numbers on a line mentioning a total keyword.
  const totals: number[] = [];
  for (const line of ocr.lines) {
    if (TOTAL_KEYWORDS.test(line)) {
      for (const n of numbersIn(line)) {
        if (n >= 10 && n <= 20000) totals.push(n);
      }
    }
  }
  if (totals.length > 0) data.totalCost = Math.max(...totals);

  // 4. Unit price — number near a price keyword, in a plausible lei/L range.
  for (const line of ocr.lines) {
    if (PRICE_KEYWORDS.test(line)) {
      const price = numbersIn(line).find((n) => n >= 3 && n <= 20);
      if (price !== undefined) {
        data.unitPrice = price;
        break;
      }
    }
  }

  // 5. Cross-check: derive litres from total / price when litres weren't read.
  if (data.liters === undefined && data.totalCost && data.unitPrice && data.unitPrice > 0) {
    const derived = data.totalCost / data.unitPrice;
    if (plausibleLiters(derived)) {
      data.liters = Math.round(derived * 100) / 100;
    }
  }

  return data;
}

/**
 * Heuristic parser for a consumable receipt. Consumables are either diesel
 * (litres) or twine (kg) — extract the primary quantity from the receipt.
 */
export function parseConsumableQuantity(ocr: OcrText): ConsumableReceiptData {
  const fuel = parseFuelReceipt(ocr);
  if (fuel.liters !== undefined) return { quantity: fuel.liters };

  // Twine: kg, frequently integer — look near a quantity/weight keyword.
  for (const line of ocr.lines) {
    if (/\b(CANT|CANTITATE|KG)\b/i.test(line)) {
      const n = numbersIn(line).find((v) => v >= 1 && v <= 5000);
      if (n !== undefined) return { quantity: n };
    }
  }
  return {};
}

/**
 * Minimal ambient types for the vendored SheetJS ESM bundle — only the
 * surface `@/lib/xlsx.ts` actually calls. See README.md for why this is
 * hand-written instead of the full upstream `types/index.d.ts` (~28 KB): it
 * would make every admin-web typecheck parse a large declaration file for a
 * handful of functions this app never touches (styling, formulas, streaming
 * readers, etc).
 *
 * Keep in sync with the SheetJS version pinned in README.md — check the
 * upstream `types/index.d.ts` for that version if a call site here needs a
 * function not yet declared.
 */

export interface ColInfo {
  wch?: number;
}

export interface WorkSheet {
  '!cols'?: ColInfo[];
  [cell: string]: unknown;
}

export interface WorkBook {
  SheetNames: string[];
  Sheets: Record<string, WorkSheet>;
}

export interface WritingOptions {
  bookType?: 'xlsx' | 'ods' | 'csv' | 'html';
  type?: 'base64' | 'binary' | 'buffer' | 'array' | 'file';
}

export const utils: {
  aoa_to_sheet(data: unknown[][]): WorkSheet;
  book_new(): WorkBook;
  book_append_sheet(workbook: WorkBook, worksheet: WorkSheet, name?: string): void;
};

export function writeFile(workbook: WorkBook, filename: string, opts?: WritingOptions): void;

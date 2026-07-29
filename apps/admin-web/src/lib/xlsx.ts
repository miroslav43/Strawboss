/**
 * Client-side XLSX export, backed by the vendored SheetJS build (see
 * `@/vendor/sheetjs/README.md` for why it's vendored rather than a
 * dependency). API deliberately mirrors `@/lib/csv.ts` so the two are
 * interchangeable at call sites.
 */

export interface XlsxColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Column width, in characters (SheetJS `!cols[i].wch`). Optional. */
  width?: number;
}

// Same guard as csv.ts: Excel evaluates leading =+-@ (and tab/CR) as a formula
// prefix in a text cell too, not just in CSV — a `.xlsx` export needs the same
// defense against a malicious "=CMD(...)"-style string ending up in a cell.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function safeCell(raw: string | number | null | undefined): string | number {
  if (raw == null) return '';
  if (typeof raw === 'number') return raw;
  return FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
}

/**
 * Build an .xlsx from `rows` and trigger a browser download.
 *
 * SheetJS is dynamic-imported so it lands in its own lazy chunk instead of
 * the initial page bundle — this function is only ever called from a click
 * handler, never on render.
 */
export async function exportXlsx<T>(
  filename: string,
  sheetName: string,
  columns: XlsxColumn<T>[],
  rows: T[],
): Promise<void> {
  const XLSX = await import('@/vendor/sheetjs/xlsx.mjs');

  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => safeCell(c.value(row)))),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  if (columns.some((c) => c.width)) {
    worksheet['!cols'] = columns.map((c) => ({ wch: c.width ?? 12 }));
  }

  const workbook = XLSX.utils.book_new();
  // Sheet names are capped at 31 chars and can't contain []:*?/\ — trim
  // defensively rather than let a longer/odd name throw inside SheetJS.
  const safeSheetName = sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1';
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);

  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, {
    bookType: 'xlsx',
  });
}

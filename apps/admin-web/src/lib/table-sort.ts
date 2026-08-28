import { EMPTY } from '@/lib/date';

/**
 * The client-side sort every `DataTable` runs.
 *
 * Pulled out of the component on purpose: it is pure, it is the part that was
 * actually wrong, and it is readable (and testable) without mounting React.
 */

export type SortDirection = 'asc' | 'desc';

/** Compares two strings for the active locale. `Intl.Collator.prototype.compare`. */
export type Collate = (a: string, b: string) => number;

/**
 * "Nothing here" for sorting purposes.
 *
 * Three spellings, because the row builders disagree: `aux-rows.ts` mirrors an
 * absent value to `null`, `TripList.tsx` mirrors it to the em-dash `EMPTY` that
 * the cell renders, and a cleared text column arrives as `''`. They used to land
 * in three different places in the sort; now they land together.
 */
function isBlank(v: unknown): boolean {
  return v == null || v === '' || v === EMPTY;
}

/**
 * Compare two cell values.
 *
 * Blanks sort LAST in both directions — deliberate, and unchanged in behaviour.
 * The old code did it by accident (the null branch returned BEFORE the direction
 * flip) but the result is right: "no trip number yet" is not "the smallest trip
 * number", and Postgres itself defaults to NULLS LAST on DESC. Making it
 * explicit is what stops the next edit from silently inverting it.
 */
export function compareCells(
  a: unknown,
  b: unknown,
  dir: SortDirection,
  collate: Collate,
): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') cmp = Number(a) - Number(b);
  // Intl.Collator, never `<`: `<` compares UTF-16 code units, so "Șerban" sorted
  // after "Zamfir" and "Őri" after "Zsolt". Same defect commit 222a3ae fixed
  // server-side for the farms report. ISO 'YYYY-MM-DD' is fixed-width, so dates
  // still compare chronologically under a collator.
  else cmp = collate(String(a), String(b));

  return dir === 'asc' ? cmp : -cmp;
}

/**
 * Sort `data` by `sortKey`, with an optional secondary key.
 *
 * Decorate–sort–undecorate: `read` runs once per row rather than O(n log n)
 * times, which matters now that a column may compute its sort value (a
 * translated label, a composed string) instead of reading a flat mirror.
 *
 * The incoming index is the final key, so a tie group keeps a fixed order
 * instead of depending on the engine's sort stability for correctness.
 */
export function sortRows<T>(
  data: T[],
  sortKey: string | null,
  sortDir: SortDirection,
  collate: Collate,
  read: (row: T, key: string) => unknown,
  tieBreakKey?: string,
): T[] {
  if (!sortKey) return data;

  const decorated = data.map((row, i) => ({ row, i, v: read(row, sortKey) }));
  decorated.sort((a, b) => {
    const primary = compareCells(a.v, b.v, sortDir, collate);
    if (primary !== 0) return primary;
    if (tieBreakKey && tieBreakKey !== sortKey) {
      // ALWAYS ascending. A tie-break that flipped with the primary arrow would
      // re-shuffle every tie group on each direction toggle — which is exactly
      // what "it doesn't sort properly" looks like from the outside.
      const secondary = compareCells(
        read(a.row, tieBreakKey),
        read(b.row, tieBreakKey),
        'asc',
        collate,
      );
      if (secondary !== 0) return secondary;
    }
    return a.i - b.i;
  });
  return decorated.map((d) => d.row);
}

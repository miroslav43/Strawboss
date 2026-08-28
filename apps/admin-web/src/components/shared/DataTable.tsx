'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { sortRows, type SortDirection } from '@/lib/table-sort';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  /**
   * What this column sorts BY, when that differs from `row[key]`.
   *
   * Lets a column sort on the same text it RENDERS — the aux "Recoltă" column
   * showed a translated label while sorting the raw enum, so in ro/hu the
   * visible order was alphabetical in a language nobody sees. Keeping this here
   * rather than in the row builders is what stops `aux-rows.ts` from having to
   * know about i18n.
   *
   * MUST be a pure function of `row` and of the active LOCALE, and of nothing
   * else. The sort memo below deliberately omits `columns` from its dependencies
   * (every call site rebuilds that array inline, so including it would defeat the
   * memo for all eight tables) and reads the accessor through a ref instead. The
   * locale is the one extra input that is safe, because `fmt.compare` is derived
   * from it and IS in the deps — so a locale switch does recompute the order.
   *
   * An accessor that closes over anything else — a filter, a feature flag, a
   * sibling prop — would leave the memo returning the previous order while the
   * cells render fresh values. If you need that, put the value on the row.
   */
  sortValue?: (row: T) => unknown;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Optional override for the empty-state message. Falls back to i18n key `common_table.noData`. */
  emptyMessage?: string;
  /**
   * Optional per-row classes, e.g. to tint a row by its state. Purely additive —
   * omitting it leaves every existing call site rendering byte-identically.
   */
  rowClassName?: (row: T) => string | undefined;
  /**
   * Column sorted on mount. Without one the table opens in whatever order the
   * server happened to return, with no chevron on any header — which reads to an
   * operator as "this table doesn't sort".
   */
  defaultSortKey?: string;
  defaultSortDir?: SortDirection;
  /**
   * Compared when the primary key ties, ALWAYS ascending. Without it, rows with
   * equal values fall back to the incoming server order — which corresponds to
   * no visible column, so a tie group reads as "sorted halfway".
   */
  tieBreakKey?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage,
  rowClassName,
  defaultSortKey,
  defaultSortDir,
  tieBreakKey,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const fmt = useLocaleFormat();
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultSortDir ?? 'asc');

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey],
  );

  /*
   * The sort accessor, read through a REF rather than through the memo deps.
   *
   * Every call site rebuilds `columns` inline on each render, so putting it in
   * the dependency array would defeat the W22 memo for all eight tables. The
   * accessor is a pure function of the row, so a ref is safe: it always reads
   * the columns of the render that is painting.
   */
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const read = useCallback((row: T, key: string) => {
    const col = columnsRef.current.find((c) => c.key === key);
    return col?.sortValue ? col.sortValue(row) : row[key];
  }, []);

  // W22: memoized. `fmt.compare` is a memoized Intl.Collator method (one per
  // locale), so it is a stable dependency rather than a fresh function.
  const sortedData = useMemo(
    () => sortRows(data, sortKey, sortDir, fmt.compare, read, tieBreakKey),
    [data, sortKey, sortDir, fmt.compare, read, tieBreakKey],
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500',
                  col.sortable && 'select-none',
                )}
                aria-sort={
                  col.sortable
                    ? sortKey === col.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                    : undefined
                }
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="flex items-center gap-1 hover:text-neutral-700"
                  >
                    {col.header}
                    {sortKey === col.key &&
                      (sortDir === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </button>
                ) : (
                  <div className="flex items-center gap-1">{col.header}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 bg-white">
          {sortedData.map((row) => (
            <tr
              key={keyExtractor(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'transition-colors',
                onRowClick && 'cursor-pointer hover:bg-neutral-50',
                rowClassName?.(row),
              )}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-neutral-700">
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {sortedData.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-neutral-400">
                {emptyMessage ?? t('common_table.noData')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

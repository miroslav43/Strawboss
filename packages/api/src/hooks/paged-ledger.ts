import type { ApiClient } from '../client/api-client.js';

/**
 * Walking a whole season's ledger, one bounded request at a time.
 *
 * The reports tables sort and re-sort in the browser over the FULL result set —
 * sorting one server page would order that page and quietly lie about the rest —
 * so the report needs everything in hand. But neither list endpoint may be asked
 * for "everything" in one shot: `GET /trips` is capped at 1000 rows and
 * `GET /trip-requests` at 1000 by `MAX_LIST_LIMIT`. So the query function walks
 * the pages itself and concatenates.
 *
 * This lives in the query FUNCTION rather than in `useInfiniteQuery` on purpose:
 * the report has no "load more" affordance and no partial state to render — it
 * wants one cache entry, one `isLoading`, one array. An infinite query would
 * expose a paging model the UI does not have.
 */

/** Rows per request. Matches the server-side cap on both endpoints. */
export const LEDGER_PAGE_SIZE = 1000;

/**
 * Hard stop, so a runaway filter cannot turn one render into an unbounded
 * request loop. 25 pages is 25 000 rows — far past any real season, and the
 * result is flagged `truncated` rather than silently short. A report that
 * quietly drops rows is worse than one that says it did.
 */
export const LEDGER_MAX_PAGES = 25;

export interface LedgerResult<T> {
  rows: T[];
  /**
   * Total matching rows on the server when it reports one (`GET /trips` emits
   * `total_count` on the paged path); otherwise the number actually fetched.
   */
  total: number;
  /** The page ceiling was hit — `rows` is the newest slice, not the whole set. */
  truncated: boolean;
}

/**
 * Both list shapes this codebase returns: a bare array, or `{ data: [...] }`.
 * `null` means neither — an error envelope or an empty body, not an empty page.
 */
function asRows<T>(body: unknown): T[] | null {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: T[] }).data;
  }
  return null;
}

/**
 * Fetch every page of `path`, `pageSize` rows at a time.
 *
 * `buildQuery` receives the offset and returns the full query string (leading
 * `?` included) — the two endpoints spell their page size differently
 * (`pageSize` vs `limit`), and normalizing that here would mean sending a
 * parameter one of them ignores.
 */
export async function fetchAllPages<T>(
  client: ApiClient,
  path: string,
  buildQuery: (offset: number, pageSize: number) => string,
  readTotal?: (page: T[]) => number | undefined,
): Promise<LedgerResult<T>> {
  const rows: T[] = [];
  let total: number | undefined;
  let exhausted = false;

  for (let page = 0; page < LEDGER_MAX_PAGES && !exhausted; page++) {
    const offset = page * LEDGER_PAGE_SIZE;
    const body = await client.get<unknown>(`${path}${buildQuery(offset, LEDGER_PAGE_SIZE)}`);
    const batch = asRows<T>(body);
    // An unrecognized body (an error envelope, an empty 204) ends the walk
    // rather than throwing inside a spread — the caller keeps what it collected.
    if (batch === null) {
      exhausted = true;
      break;
    }
    rows.push(...batch);
    if (total === undefined) total = readTotal?.(batch);
    // A short page is the end of the data. A FULL page means there may be more —
    // unless the server told us the total and we already have it, in which case
    // one more round trip would only ever come back empty.
    exhausted = batch.length < LEDGER_PAGE_SIZE || (total !== undefined && rows.length >= total);
  }

  return { rows, total: total ?? rows.length, truncated: !exhausted };
}

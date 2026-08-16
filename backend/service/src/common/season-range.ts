import { sql, type SQL } from 'drizzle-orm';
import { seasonBounds } from '@strawboss/types';

/**
 * ONE date-window predicate for the whole backend.
 *
 * Before this file there were four conventions: `productionDateFilter` and
 * `timestampRangeFilter` in ReportsService, `productionDateFilter` and
 * `loggedAtFilter` in DashboardService, plus the bespoke pair in
 * TripsService.list. Three of the four anchored bare calendar days to UTC —
 * `dateTo::date + 1` and `dateTo + 'T23:59:59.999Z'` — which shifts every
 * boundary by 2-3 hours in Romania. Only TripsService got it right, and only
 * after a documented investigation. This is that investigation, generalised.
 *
 * ── THE CAST CHAIN IS LOAD-BEARING ──────────────────────────────────────────
 *
 * `AT TIME ZONE` picks its direction from the operand's type, and a bare `date`
 * prefers the implicit cast to timestamptz:
 *
 *   date::timestamptz AT TIME ZONE z -> timestamp    "wall clock in z at this instant"
 *   date::timestamp   AT TIME ZONE z -> timestamptz  "this wall clock, read as local time in z"
 *
 * Only the second is what we mean. Without the `::date::timestamp` double cast
 * the bound lands 2-3 hours off (verified against the database). With it,
 * '2026-01-01' resolves to exactly 2025-12-31T22:00:00Z — bit-identical to what
 * mobile's startOfDayRomaniaISO() sends — and it follows DST instead of
 * hardcoding an offset.
 *
 * ── ALWAYS HALF-OPEN, NEVER EXTRACT(YEAR ...) ───────────────────────────────
 *
 * The upper bound is exclusive: `< dateTo + 1 day`. An inclusive bound on a
 * timestamptz forces a choice between dropping the whole final day and chasing
 * the last millisecond with a different literal per column type.
 *
 * A season is expressed as a range and never as `EXTRACT(YEAR FROM col) = y`.
 * A year predicate is not sargable, and this system cannot build the expression
 * index that would rescue it: the migration runner wraps every file in
 * `psql --single-transaction` (scripts/05-db.sh), so CREATE INDEX CONCURRENTLY
 * is impossible. The plain btree indexes that already exist on created_at /
 * logged_at / production_date serve a range scan directly.
 */

const ROMANIA_TZ = 'Europe/Bucharest';

/** A bare calendar day, as opposed to a full ISO instant. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An inclusive date window, in the shape every existing endpoint already
 * speaks: `dateFrom`/`dateTo` as bare `YYYY-MM-DD`. Full ISO instants are
 * accepted and passed through unchanged, so existing callers are unaffected.
 */
export interface DateWindow {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The inclusive window of a season.
 *
 * Returned in the inclusive `dateTo` form rather than the half-open form so it
 * drops straight into the endpoints that already take `dateFrom`/`dateTo` from
 * a query string. The conversion to a half-open instant range happens once,
 * inside the filters below.
 */
export function seasonWindow(year: number): Required<DateWindow> {
  const { startDate } = seasonBounds(year);
  return { dateFrom: startDate, dateTo: `${year}-12-31` };
}

/**
 * Narrow an explicit caller-supplied window to a season.
 *
 * Used when a request carries BOTH `season` and an explicit range: the season
 * wins as an outer bound, so a report cannot silently read across a season
 * boundary just because a date picker was left on last month.
 */
export function clampToSeason(year: number, requested?: DateWindow): Required<DateWindow> {
  const season = seasonWindow(year);
  const from =
    requested?.dateFrom && requested.dateFrom > season.dateFrom
      ? requested.dateFrom
      : season.dateFrom;
  const to =
    requested?.dateTo && requested.dateTo < season.dateTo ? requested.dateTo : season.dateTo;
  return { dateFrom: from, dateTo: to };
}

/**
 * Window predicate for a TIMESTAMPTZ column.
 *
 * `col` is passed as SQL rather than a string so callers keep their own table
 * aliases (`t.created_at`, `bl.loaded_at`) and nothing here has to know about
 * the surrounding query.
 */
export function tsWindowFilter(col: SQL, window?: DateWindow): SQL[] {
  const conditions: SQL[] = [];
  if (window?.dateFrom) {
    conditions.push(
      CALENDAR_DAY.test(window.dateFrom)
        ? sql`${col} >= (${window.dateFrom}::date::timestamp AT TIME ZONE ${ROMANIA_TZ})`
        : sql`${col} >= ${window.dateFrom}`,
    );
  }
  if (window?.dateTo) {
    conditions.push(
      CALENDAR_DAY.test(window.dateTo)
        ? sql`${col} < ((${window.dateTo}::date + INTERVAL '1 day')::timestamp AT TIME ZONE ${ROMANIA_TZ})`
        : sql`${col} <= ${window.dateTo}`,
    );
  }
  return conditions;
}

/**
 * Window predicate for a DATE column.
 *
 * A DATE is already a calendar day with no timezone, so it compares directly
 * against the bare strings — applying the timestamptz conversion here would
 * introduce the very shift it exists to prevent.
 */
export function dateWindowFilter(col: SQL, window?: DateWindow): SQL[] {
  const conditions: SQL[] = [];
  if (window?.dateFrom) conditions.push(sql`${col} >= ${window.dateFrom}::date`);
  if (window?.dateTo) conditions.push(sql`${col} <= ${window.dateTo}::date`);
  return conditions;
}

/** `tsWindowFilter` collapsed into a single `AND ...` fragment, or empty. */
export function tsWindowClause(col: SQL, window?: DateWindow): SQL {
  const parts = tsWindowFilter(col, window);
  if (parts.length === 0) return sql``;
  return sql` AND ${sql.join(parts, sql` AND `)}`;
}

/** `dateWindowFilter` collapsed into a single `AND ...` fragment, or empty. */
export function dateWindowClause(col: SQL, window?: DateWindow): SQL {
  const parts = dateWindowFilter(col, window);
  if (parts.length === 0) return sql``;
  return sql` AND ${sql.join(parts, sql` AND `)}`;
}

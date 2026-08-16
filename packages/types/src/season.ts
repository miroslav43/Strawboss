/**
 * Seasons — the SINGLE SOURCE OF TRUTH for what "this year's numbers" means.
 *
 * A season is a strict calendar year in Europe/Bucharest. Nothing is ever
 * deleted or archived when a season ends: the reset a farmer sees is a READ
 * FILTER, and the physical quantities that genuinely survive the year (depot
 * stock, engine hours) are carried as opening balances.
 *
 * ── THE SEASON IS DERIVED, NEVER STAMPED ────────────────────────────────────
 *
 * There is deliberately no `season_id` column on trips / bale_loads /
 * fuel_logs / ... . A row's season is a pure function of its own business date,
 * which is what `SEASON_DATE_COLUMN` below records. Four reasons, all of them
 * paid for by production incidents rather than taste:
 *
 *   * No backfill, and no stored state that can drift away from the date. The
 *     season of a row is recomputed from the row itself, every time.
 *   * CORRECTING A DATE CORRECTS THE SEASON. An admin who fixes a wrong
 *     `production_date` moves that row into the right year for free. A stamped
 *     column would keep the row filed under the season it was created in, and
 *     the two would disagree silently and forever.
 *   * RLS stays untouched. A real season column would need a new predicate on
 *     USING *and* WITH CHECK across ~50 policies; miss one WITH CHECK and a
 *     user can write into a closed season.
 *   * `sync_version_seq` is not disturbed. It is a GLOBAL sequence shared by
 *     every organization and 9 tables (migration 00040), so the mass UPDATE
 *     needed to stamp a column would force every phone in every tenant to
 *     re-pull everything.
 *
 * ── WHAT THIS DOES *NOT* FIX: SERVER-STAMPED WORK TIMES ─────────────────────
 *
 * `bale_loads.loaded_at` is written as `NOW()` on the server, in both write
 * paths (TripsService.registerLoad and BaleLoadsService.create) — there is no
 * device-time column to reconstruct from. A load performed offline on 31
 * December and pushed on 2 January is therefore recorded as 2 January and falls
 * in the NEW season, no matter how the season is computed. Deriving does not
 * make this worse than stamping would (a stamped row would use the active
 * season at push time, i.e. the same wrong year) but it does not make it
 * better either.
 *
 * This is why closing a season is a manual act with a pre-flight that counts
 * devices which have not checked in recently. Draining the field before closing
 * is the mitigation; there is no clever query that recovers the lost intent.
 *
 * ── WHY THE TIMEZONE IS NOT A DETAIL ────────────────────────────────────────
 *
 * `new Date().getFullYear()` on a UTC server reports the wrong year for two
 * hours every 31 December: 31 Dec 23:00 in Bucharest is 21:00 UTC on the same
 * day, but 1 Jan 01:00 in Bucharest is 31 Dec 23:00 UTC. A trip created at a
 * New Year's Eve loading would land in the season that just closed and be
 * rejected as a write into a locked period. Every boundary here is therefore
 * computed through Intl in `SEASON_TIMEZONE`, and the SQL side converts with
 * `::date::timestamp AT TIME ZONE 'Europe/Bucharest'` — the cast matters, see
 * the note on `seasonBounds`.
 *
 * ── CLOSING IS A SEPARATE, MANUAL ACT ───────────────────────────────────────
 *
 * The year rolls over on its own at midnight: new rows simply carry a new year
 * and every statistic restarts from zero without anyone pressing anything. The
 * admin closes the previous season LATER, once field work has demonstrably
 * synced. Closing computes the opening balances, snapshots per-parcel seasonal
 * state, and locks the year against further writes.
 */

/** Business timezone. Every season boundary is a wall-clock instant here. */
export const SEASON_TIMEZONE = 'Europe/Bucharest';

/**
 * Sanity bounds, mirrored by CHECK constraints in migration 00098. They exist
 * to turn a mis-parsed query parameter into a rejected request rather than a
 * full table scan for the year 12026.
 */
export const SEASON_MIN_YEAR = 2020;
export const SEASON_MAX_YEAR = 2200;

/** A season is either accepting writes or frozen. */
export type SeasonStatus = 'open' | 'closed';

/** One row of `organization_seasons`. Absence of a row means 'open'. */
export interface Season {
  id: string;
  organizationId: string;
  year: number;
  status: SeasonStatus;
  closedAt: string | null;
  closedBy: string | null;
  closingNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of `season_opening_balances`. Exactly one target is non-null. */
export interface SeasonOpeningBalance {
  id: string;
  organizationId: string;
  /** The season this balance OPENS (i.e. the closed year + 1). */
  seasonYear: number;
  depotId: string | null;
  parcelId: string | null;
  baleCount: number;
  netWeightKg: number;
  sourceSeasonYear: number | null;
  createdAt: string;
}

/** One row of `parcel_season_snapshots` — the parcel's state when a season closed. */
export interface ParcelSeasonSnapshot {
  id: string;
  organizationId: string;
  seasonYear: number;
  parcelId: string;
  harvestStatus: string | null;
  cropType: string | null;
  balesProduced: number;
  balesLoaded: number;
  createdAt: string;
}

/**
 * Which column decides a row's season, per table.
 *
 * `kind` is not decoration: a DATE column is already a calendar day and
 * compares directly against `YYYY-MM-DD`, while a TIMESTAMPTZ needs the
 * Bucharest wall-clock conversion. Filtering a timestamptz as if it were a date
 * silently shifts every boundary by 2–3 hours.
 *
 * The choice of column per table is a business judgement, not a mechanical one:
 *
 *   * `trips.created_at` — a trip belongs to the season it was DISPATCHED in,
 *     so a course that starts on 31 December and completes on 2 January stays
 *     whole instead of splitting across two seasons.
 *   * `bale_loads.loaded_at` / `bale_productions.production_date` — the season
 *     of the physical work, which is what a field report is about.
 *   * `fuel_logs.logged_at` / `consumable_logs.logged_at` — the season the cost
 *     was incurred.
 *   * `task_assignments.assignment_date` — the operational day it was planned
 *     for, never when the row happened to be created.
 *   * `alerts.created_at` — an unacknowledged alert from a closed season must
 *     not keep ringing the bell in the new one.
 */
export const SEASON_DATE_COLUMN = {
  trips: { column: 'created_at', kind: 'timestamptz' },
  trip_requests: { column: 'created_at', kind: 'timestamptz' },
  bale_loads: { column: 'loaded_at', kind: 'timestamptz' },
  bale_productions: { column: 'production_date', kind: 'date' },
  fuel_logs: { column: 'logged_at', kind: 'timestamptz' },
  consumable_logs: { column: 'logged_at', kind: 'timestamptz' },
  task_assignments: { column: 'assignment_date', kind: 'date' },
  parcel_bale_adjustments: { column: 'created_at', kind: 'timestamptz' },
  parcel_daily_status: { column: 'status_date', kind: 'date' },
  alerts: { column: 'created_at', kind: 'timestamptz' },
  documents: { column: 'created_at', kind: 'timestamptz' },
} as const satisfies Record<string, { column: string; kind: 'date' | 'timestamptz' }>;

/** Tables whose season can be derived. */
export type SeasonScopedTable = keyof typeof SEASON_DATE_COLUMN;

/**
 * The half-open calendar bounds of a season: `[startDate, endDateExclusive)`.
 *
 * Half-open, not inclusive, on purpose. An inclusive upper bound on a
 * timestamptz forces a choice between `<= '2026-12-31'` (which drops everything
 * recorded during the last day) and `<= '2026-12-31 23:59:59.999'` (which drops
 * the final millisecond and needs a different literal per column type). The
 * exclusive form is correct for both kinds with one expression.
 *
 * On the SQL side these two strings become:
 *
 *   DATE column:        col >= '2026-01-01' AND col < '2027-01-01'
 *   TIMESTAMPTZ column: col >= ('2026-01-01'::date::timestamp AT TIME ZONE 'Europe/Bucharest')
 *                   AND col <  ('2027-01-01'::date::timestamp AT TIME ZONE 'Europe/Bucharest')
 *
 * The `::date::timestamp` double cast is load-bearing and was verified against
 * the database (see the note in TripsService.list): `AT TIME ZONE` picks its
 * direction from the operand's type, and a bare `date` prefers the implicit
 * cast to timestamptz, which yields "wall-clock in Bucharest at this instant"
 * instead of "this wall-clock read as Bucharest local time". Without the cast
 * every bound lands 2–3 hours off, and it follows DST rather than hardcoding an
 * offset.
 */
export function seasonBounds(year: number): {
  startDate: string;
  endDateExclusive: string;
} {
  return {
    startDate: `${year}-01-01`,
    endDateExclusive: `${year + 1}-01-01`,
  };
}

/** The calendar year of `instant` in the business timezone. */
export function seasonYearOf(instant: Date = new Date()): number {
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone: SEASON_TIMEZONE,
    year: 'numeric',
  }).format(instant);
  return Number(value);
}

/** The season the world is currently in, regardless of what any org has closed. */
export function currentSeasonYear(): number {
  return seasonYearOf();
}

/** Whether `year` is a plausible season, matching the DB CHECK constraints. */
export function isValidSeasonYear(year: unknown): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= SEASON_MIN_YEAR &&
    year <= SEASON_MAX_YEAR
  );
}

/**
 * Which season a request should read, given what it asked for and what the
 * organization has on record.
 *
 * The fallback chain is deliberate. `activeSeasonYear` is a read cache written
 * when a season is closed, so it is NULL for every organization that has never
 * closed one — which is all of them until the first rollover. Falling through
 * to the current calendar year means this whole system is inert until someone
 * actually closes a season, and an org that never closes one keeps seeing the
 * year it is living in.
 */
export function resolveSeasonYear(
  requested: number | null | undefined,
  activeSeasonYear: number | null | undefined,
): number {
  if (isValidSeasonYear(requested)) return requested;
  if (isValidSeasonYear(activeSeasonYear)) return activeSeasonYear;
  return currentSeasonYear();
}

/**
 * The seasons an organization can offer in a picker: every year from its first
 * recorded season up to the current one, newest first.
 *
 * Derived rather than stored, because `organization_seasons` only gains a row
 * when a season is closed — the years in between have data but no row.
 */
export function seasonYearRange(earliestYear: number | null | undefined): number[] {
  const current = currentSeasonYear();
  const first = isValidSeasonYear(earliestYear) ? Math.min(earliestYear, current) : current;
  const years: number[] = [];
  for (let y = current; y >= first; y--) years.push(y);
  return years;
}

/**
 * What the admin is shown before closing a season, and what blocks the close.
 *
 * `openTrips` and `devicesNotCheckedIn` are BLOCKING for the same underlying
 * reason: a closed season rejects writes, and a rejected write from a phone is
 * not a harmless error. A non-terminal rejection puts the mutation into
 * quadratic backoff and destroys it after 7 days, taking the operator's field
 * work with it. Closing only once the field is demonstrably drained is the
 * whole mitigation.
 */
export interface SeasonPreflight {
  year: number;
  /** Non-terminal trips still open in the season being closed. */
  openTrips: number;
  /** Devices with an assigned user that have not checked in recently. */
  devicesNotCheckedIn: number;
  /** Informational only — never blocks. */
  unacknowledgedAlerts: number;
  /** Depots that will receive a carried-forward opening balance. */
  depotsWithStock: number;
  /** Total bales that will carry into the next season. */
  balesCarriedForward: number;
  /** Parcels whose harvest status will be reset to 'planned'. */
  parcelsToReset: number;
  /** True when nothing blocks the close. */
  canClose: boolean;
}

/** Payload for closing a season. `reason` is mandatory, as with feature toggles. */
export interface CloseSeasonDto {
  year: number;
  reason: string;
}

/** What the admin gets back after a successful close. */
export interface CloseSeasonResult {
  closedYear: number;
  newActiveYear: number;
  depotBalancesWritten: number;
  balesCarriedForward: number;
  parcelsSnapshotted: number;
  parcelsReset: number;
  orderCountersReset: number;
}

/** The season context every client needs to render a picker and a default. */
export interface SeasonContext {
  activeSeasonYear: number;
  availableYears: number[];
  closedYears: number[];
}

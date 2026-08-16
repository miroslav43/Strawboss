import type * as SQLite from 'expo-sqlite';
import { SEASON_TIMEZONE } from '@strawboss/types';
import { mobileLogger } from '../lib/logger';

const ACTIVE_SEASON_KEY = 'active_season_year';

/**
 * Reacting on the phone to a season rollover on the server.
 *
 * A rollover changes no row. It writes `organizations.active_season_year` and
 * some balance rows, and every aggregate in the product re-scopes itself — but
 * not a single `sync_version` moves, so delta sync has nothing to deliver and
 * the phone would never find out. `activeSeasonYear` on the pull response is
 * that signal.
 *
 * ── WHY THIS IS A LOCAL DELETE AND NOT A SERVER FILTER ──────────────────────
 *
 * The obvious alternative — filter the pull by season on the server — is a trap
 * this codebase has already paid for once. `sync.service.ts` force-includes
 * every non-terminal trip on every pull, with a comment demanding it stay
 * exactly as it is, because an out-of-order `sync_version` once stranded an
 * `in_transit` trip behind the cursor forever. A season predicate on that arm
 * would make a trip created on 31 December vanish from the driver's phone
 * mid-haul on 1 January. And because the local cursor only ever moves forward,
 * a server that silently stops sending rows produces no signal at all.
 *
 * So the server keeps telling the truth and the phone tidies its own cache.
 */

/** The season this device last saw, or null if it has never been told. */
export async function getKnownSeasonYear(db: SQLite.SQLiteDatabase): Promise<number | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_state WHERE key = ?',
    [ACTIVE_SEASON_KEY],
  );
  const value = row?.value;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function setKnownSeasonYear(db: SQLite.SQLiteDatabase, year: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [ACTIVE_SEASON_KEY, String(year)],
  );
}

/**
 * Which local table is dated by which column, and which rows are safe to drop.
 *
 * `trips` is restricted to terminal statuses on purpose — the same invariant
 * the server's force-include arm protects. A trip that is still moving belongs
 * on the phone regardless of which season it started in.
 */
const PRUNABLE: {
  table: string;
  dateColumn: string;
  /**
   * 'date' compares against a bare calendar day; 'timestamptz' against the UTC
   * instant of local midnight. Getting this wrong shifts every boundary by the
   * Romanian offset — see `seasonBoundsFor` below.
   */
  kind: 'date' | 'timestamptz';
  extraWhere?: string;
}[] = [
  {
    table: 'trips',
    dateColumn: 'created_at',
    kind: 'timestamptz',
    extraWhere: "status IN ('completed', 'cancelled')",
  },
  { table: 'bale_loads', dateColumn: 'loaded_at', kind: 'timestamptz' },
  { table: 'bale_productions', dateColumn: 'production_date', kind: 'date' },
  { table: 'fuel_logs', dateColumn: 'logged_at', kind: 'timestamptz' },
  { table: 'consumable_logs', dateColumn: 'logged_at', kind: 'timestamptz' },
  { table: 'task_assignments', dateColumn: 'assignment_date', kind: 'date' },
];

/**
 * The two boundary strings to compare a column against, by column kind.
 *
 * A DATE column holds a bare local calendar day (`todayInRomania()`), so it
 * compares directly against `YYYY-01-01`.
 *
 * A TIMESTAMPTZ column holds a UTC instant (`new Date().toISOString()` locally,
 * and the server's ISO serialisation on pulled rows). Comparing THAT against a
 * bare local day is wrong by the Romanian offset: a bale loaded at 00:30 on 1
 * January local time is stored as `...-12-31T22:30:00.000Z`, which sorts below
 * `'YYYY-01-01'` and would be filed under the season that just ended — while
 * the server, which converts with `AT TIME ZONE 'Europe/Bucharest'`, counts it
 * in the new one. Two sides of the same system disagreeing about which season a
 * row belongs to is exactly what this file exists to avoid.
 *
 * So a timestamptz boundary is the UTC instant OF local midnight, computed via
 * Intl rather than a hardcoded +02:00 so it follows DST. (Both season
 * boundaries fall in winter time, but the helper should not depend on that.)
 */
function seasonBoundsFor(year: number, kind: 'date' | 'timestamptz'): [string, string] {
  if (kind === 'date') return [`${year}-01-01`, `${year + 1}-01-01`];
  return [localMidnightUtcIso(year), localMidnightUtcIso(year + 1)];
}

/**
 * The UTC ISO instant of 1 January 00:00 in the business timezone.
 *
 * Both sides of the offset calculation go through `Date.UTC`, deliberately: the
 * obvious `new Date(instant).toLocaleString(...)` round-trip re-parses its own
 * output in the RUNTIME's timezone, so it silently returns a different answer
 * on a phone set to Bucharest than on a CI box set to UTC. Reading the zone's
 * wall clock through `formatToParts` and re-assembling it as UTC is independent
 * of wherever the device thinks it is.
 */
function localMidnightUtcIso(year: number): string {
  const target = Date.UTC(year, 0, 1, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SEASON_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(target));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour` can format as 24 for midnight under hour12:false in some runtimes.
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return new Date(target - (asUtc - target)).toISOString();
}

/**
 * Drop finished local rows that belong to a season the device is no longer in.
 *
 * Three guards, and every one of them has to hold before a row goes:
 *
 *   1. Its own date is outside the active season.
 *   2. It is in a terminal state (trips only — nothing half-done is touched).
 *   3. THE SERVER HAS IT. `server_version > 0` is only ever written when a pull
 *      confirms the row (locally-created rows start at 0), so this is a direct
 *      statement of "this exists somewhere other than here".
 *   4. It has NO open `sync_queue` entry.
 *
 * Guards 3 and 4 look redundant and are not. Guard 4 alone was the original
 * design and it has a hole: `SyncQueueRepo.purgeStale()` deletes queue entries
 * that failed more than ten times and are older than a week — i.e. work that
 * never reached the server at all — after which guard 4 sees a clean row and
 * waves it through. And `retry_count` climbs through ordinary repeated network
 * interruptions in the field, not just through genuinely bad data, so the
 * entries this destroys are legitimate work. Guard 3 closes that hole.
 *
 * Guard 4 still earns its place: a row accepted by the server but not yet
 * re-pulled has `server_version = 0` while its queue entry is still open, so
 * only the pair covers both directions.
 *
 * Never touched at all: `parcels` and `delivery_destinations` (master data, not
 * seasonal), `sync_queue` and `sync_cursors` (pruning a cursor forces a full
 * re-pull), `notifications` (own 7-day lifecycle).
 */
export async function pruneOutOfSeason(
  db: SQLite.SQLiteDatabase,
  seasonYear: number,
): Promise<number> {
  let removed = 0;

  for (const { table, dateColumn, kind, extraWhere } of PRUNABLE) {
    const [start, endExclusive] = seasonBoundsFor(seasonYear, kind);
    const conditions = [
      `(${dateColumn} IS NULL OR ${dateColumn} < ? OR ${dateColumn} >= ?)`,
      `COALESCE(server_version, 0) > 0`,
      `id NOT IN (SELECT entity_id FROM sync_queue WHERE entity_id IS NOT NULL)`,
    ];
    if (extraWhere) conditions.push(extraWhere);

    try {
      const result = await db.runAsync(`DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`, [
        start,
        endExclusive,
      ]);
      removed += result.changes ?? 0;
    } catch (err) {
      // A prune failure must never break the sync cycle it rides on — the cache
      // being larger than necessary is harmless, a failed sync is not.
      mobileLogger.warn('season.prune.failed', {
        table,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return removed;
}

/**
 * Everything the phone must do when the server reports a different season.
 *
 * Returns true when a change was handled, so the caller can log it.
 */
export async function applySeasonChange(
  db: SQLite.SQLiteDatabase,
  activeSeasonYear: number,
): Promise<boolean> {
  const known = await getKnownSeasonYear(db);
  if (known === activeSeasonYear) return false;

  // The depot dashboard cache has no TTL and no invalidation of its own
  // (schema.ts), and it is read on cold boot while offline. Left alone, a depot
  // manager would be shown LAST season's stock as though it were current, with
  // nothing on screen to suggest otherwise. It is a pure cache, so dropping it
  // costs one refetch.
  await db.runAsync('DELETE FROM deposit_inventory_cache');

  const removed = await pruneOutOfSeason(db, activeSeasonYear);
  await setKnownSeasonYear(db, activeSeasonYear);

  mobileLogger.flow('season.changed', {
    from: known,
    to: activeSeasonYear,
    prunedRows: removed,
  });
  return true;
}

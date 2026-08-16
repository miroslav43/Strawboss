import type * as SQLite from 'expo-sqlite';
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
const PRUNABLE: { table: string; dateColumn: string; extraWhere?: string }[] = [
  { table: 'trips', dateColumn: 'created_at', extraWhere: "status IN ('completed', 'cancelled')" },
  { table: 'bale_loads', dateColumn: 'loaded_at' },
  { table: 'bale_productions', dateColumn: 'production_date' },
  { table: 'fuel_logs', dateColumn: 'logged_at' },
  { table: 'consumable_logs', dateColumn: 'logged_at' },
  { table: 'task_assignments', dateColumn: 'assignment_date' },
];

/**
 * Drop finished local rows that belong to a season the device is no longer in.
 *
 * Three guards, and every one of them has to hold before a row goes:
 *
 *   1. Its own date is outside the active season.
 *   2. It is in a terminal state (trips only — nothing half-done is touched).
 *   3. It has NO open `sync_queue` entry. This is the rule ParcelsRepo already
 *      states for its own pruning: the rows this must NEVER touch are the ones
 *      the server has not seen yet. Deleting one destroys field work that
 *      exists nowhere else.
 *
 * Never touched at all: `parcels` and `delivery_destinations` (master data, not
 * seasonal), `sync_queue` and `sync_cursors` (pruning a cursor forces a full
 * re-pull), `notifications` (own 7-day lifecycle).
 */
export async function pruneOutOfSeason(
  db: SQLite.SQLiteDatabase,
  seasonYear: number,
): Promise<number> {
  const start = `${seasonYear}-01-01`;
  const endExclusive = `${seasonYear + 1}-01-01`;
  let removed = 0;

  for (const { table, dateColumn, extraWhere } of PRUNABLE) {
    // Dates are stored as ISO strings, so a lexicographic comparison against
    // 'YYYY-01-01' is also a chronological one — true for both bare days and
    // full ISO instants, since the prefix is the same.
    const conditions = [
      `(${dateColumn} IS NULL OR ${dateColumn} < ? OR ${dateColumn} >= ?)`,
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

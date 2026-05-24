import type * as SQLite from 'expo-sqlite';

/**
 * Persists the last `server_version` the client has acknowledged per syncable
 * table. The SyncManager reads this on every pull and writes it after the
 * batch has been fully applied (both upserts and tombstones).
 *
 * Why a dedicated table instead of `SELECT MAX(server_version) FROM <table>`?
 * Tombstones cause us to DELETE the local row whose version was the highest
 * we'd ever seen — so MAX scans drop back. Without persisting the cursor, the
 * server would re-emit the same tombstones forever, and LIMIT 1000 could then
 * starve fresh updates.
 */
export class SyncCursorsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  /**
   * Returns the cursor for a table, or `null` if no cursor was ever written.
   * Callers fall back to per-table `MAX(server_version)` on null so existing
   * installs upgrade smoothly (the first pull bootstraps the cursor).
   */
  async get(tableName: string): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ server_version: number }>(
      `SELECT server_version FROM sync_cursors WHERE table_name = ?`,
      [tableName],
    );
    return row ? Number(row.server_version) : null;
  }

  /**
   * Persists a cursor advance. Idempotent — never moves the cursor backwards
   * (uses GREATEST-equivalent semantics via the conditional UPDATE on conflict).
   */
  async upsert(tableName: string, serverVersion: number): Promise<void> {
    if (!Number.isFinite(serverVersion) || serverVersion < 0) return;
    await this.db.runAsync(
      `INSERT INTO sync_cursors (table_name, server_version, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(table_name) DO UPDATE SET
         server_version = MAX(excluded.server_version, sync_cursors.server_version),
         updated_at = datetime('now')`,
      [tableName, serverVersion],
    );
  }
}

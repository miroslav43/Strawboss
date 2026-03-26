import type * as SQLite from 'expo-sqlite';

export interface SyncQueueEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: string;
  idempotency_key: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueInput {
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  idempotencyKey: string;
}

export class SyncQueueRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async enqueue(entry: EnqueueInput): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO sync_queue (entity_type, entity_id, action, payload, idempotency_key)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.entityType,
        entry.entityId,
        entry.action,
        JSON.stringify(entry.payload),
        entry.idempotencyKey,
      ]
    );
  }

  async dequeue(limit: number = 50): Promise<SyncQueueEntry[]> {
    return this.db.getAllAsync<SyncQueueEntry>(
      `SELECT * FROM sync_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit]
    );
  }

  async markInFlight(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.runAsync(
      `UPDATE sync_queue
       SET status = 'in_flight', updated_at = datetime('now')
       WHERE id IN (${placeholders})`,
      ids
    );
  }

  async markCompleted(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.runAsync(
      `UPDATE sync_queue
       SET status = 'completed', updated_at = datetime('now')
       WHERE id IN (${placeholders})`,
      ids
    );
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE sync_queue
       SET status = 'failed',
           last_error = ?,
           retry_count = retry_count + 1,
           updated_at = datetime('now')
       WHERE id = ?`,
      [error, id]
    );
  }

  async getPendingCount(): Promise<number> {
    const result = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending', 'in_flight')`
    );
    return result?.count ?? 0;
  }

  async getFailedEntries(): Promise<SyncQueueEntry[]> {
    return this.db.getAllAsync<SyncQueueEntry>(
      `SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY updated_at DESC`
    );
  }

  async retry(id: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE sync_queue
       SET status = 'pending', updated_at = datetime('now')
       WHERE id = ?`,
      [id]
    );
  }

  async purgeCompleted(): Promise<void> {
    await this.db.runAsync(
      `DELETE FROM sync_queue WHERE status = 'completed'`
    );
  }
}

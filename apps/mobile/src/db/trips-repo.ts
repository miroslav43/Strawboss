import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalTrip {
  id: string;
  trip_number: string | null;
  status: string;
  source_parcel_id: string | null;
  destination_id: string | null;
  destination_name: string | null;
  destination_address: string | null;
  truck_id: string | null;
  driver_id: string | null;
  loader_id: string | null;
  loader_operator_id: string | null;
  bale_count: number;
  departure_odometer_km: number | null;
  arrival_odometer_km: number | null;
  gross_weight_kg: number | null;
  tare_weight_kg: number | null;
  receiver_name: string | null;
  loading_started_at: string | null;
  loading_completed_at: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  /** Local-only: when the driver tapped the trip card to dismiss the NOU badge. */
  acknowledged_at: string | null;
  /** FM-1: 1 when a transition was applied locally but not yet confirmed by server. */
  has_pending_transition: number | null;
  /** FM-1: last completed delivery step (0=weight, 1=bales, 2=photo, 3=signature). */
  delivery_step_progress: number | null;
  /** FM-1: JSON blob with in-progress delivery data for crash recovery. */
  delivery_draft_json: string | null;
  /** Plan C — root iteration when NULL, otherwise FK to the root trip in the course. */
  parent_trip_id: string | null;
  /** Plan C — 1-based iteration counter inside the course. Defaults to 1. */
  iteration_index: number | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class TripsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async upsert(trip: LocalTrip): Promise<void> {
    const columns = Object.keys(trip) as (keyof LocalTrip)[];
    const placeholders = columns.map(() => '?').join(', ');
    const values: SQLiteBindValue[] = columns.map((col) => {
      const raw = trip[col];
      return raw != null ? (raw as SQLiteBindValue) : null;
    });
    const updateClauses = columns
      .filter((col) => col !== 'id')
      .map((col) => `${col} = excluded.${col}`)
      .join(', ');

    await this.db.runAsync(
      `INSERT INTO trips (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateClauses}`,
      values,
    );
  }

  async findById(id: string): Promise<LocalTrip | null> {
    const result = await this.db.getFirstAsync<LocalTrip>(`SELECT * FROM trips WHERE id = ?`, [id]);
    return result ?? null;
  }

  async listActive(): Promise<LocalTrip[]> {
    return this.db.getAllAsync<LocalTrip>(
      `SELECT * FROM trips
       WHERE status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC`,
    );
  }

  async listAll(limit = 200): Promise<LocalTrip[]> {
    return this.db.getAllAsync<LocalTrip>(`SELECT * FROM trips ORDER BY created_at DESC LIMIT ?`, [
      limit,
    ]);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id],
    );
  }

  /** Mark a trip as acknowledged so the NOU badge disappears locally. */
  async acknowledge(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET acknowledged_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [id],
    );
  }

  async update(id: string, data: Partial<LocalTrip>): Promise<void> {
    const fields: string[] = [];
    const values: SQLiteBindValue[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = ?`);
      values.push(value != null ? (value as SQLiteBindValue) : null);
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = datetime('now')`);
    values.push(id);

    await this.db.runAsync(`UPDATE trips SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM trips`,
    );
    return result?.max_ver ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM trips WHERE id = ?`, [id]);
  }

  /**
   * FM-1: Apply a state machine transition optimistically to the local trip.
   * Updates status and any metadata fields that belong to that transition,
   * and marks `has_pending_transition = 1` so the UI can show a sync badge.
   */
  async applyTransitionLocally(
    id: string,
    newStatus: string,
    meta?: Partial<LocalTrip>,
  ): Promise<void> {
    const fields: string[] = [
      'status = ?',
      'has_pending_transition = 1',
      `updated_at = datetime('now')`,
    ];
    const values: (string | number | null)[] = [newStatus];

    if (meta) {
      for (const [key, value] of Object.entries(meta)) {
        if (key === 'id') continue;
        fields.push(`${key} = ?`);
        values.push(value != null ? (value as string | number | null) : null);
      }
    }

    values.push(id);
    await this.db.runAsync(`UPDATE trips SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  /**
   * FM-1: Clear the pending transition flag once the server has confirmed
   * the transition (called by SyncManager after successful push).
   */
  async clearPendingTransitionFlag(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET has_pending_transition = 0, updated_at = datetime('now') WHERE id = ?`,
      [id],
    );
  }

  /**
   * FM-1: Persist delivery draft data for crash recovery.
   */
  async saveDeliveryDraft(id: string, step: number, draftJson: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET delivery_step_progress = ?, delivery_draft_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [step, draftJson, id],
    );
  }

  /**
   * FM-1: Clear delivery draft after successful completion.
   */
  async clearDeliveryDraft(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET delivery_step_progress = NULL, delivery_draft_json = NULL, updated_at = datetime('now') WHERE id = ?`,
      [id],
    );
  }
}

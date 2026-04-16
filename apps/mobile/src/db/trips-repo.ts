import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalTrip {
  id: string;
  trip_number: string | null;
  status: string;
  source_parcel_id: string | null;
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
      values
    );
  }

  async findById(id: string): Promise<LocalTrip | null> {
    const result = await this.db.getFirstAsync<LocalTrip>(
      `SELECT * FROM trips WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async listActive(): Promise<LocalTrip[]> {
    return this.db.getAllAsync<LocalTrip>(
      `SELECT * FROM trips
       WHERE status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC`
    );
  }

  async listAll(): Promise<LocalTrip[]> {
    return this.db.getAllAsync<LocalTrip>(
      `SELECT * FROM trips ORDER BY created_at DESC`
    );
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE trips SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id]
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

    await this.db.runAsync(
      `UPDATE trips SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM trips`
    );
    return result?.max_ver ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM trips WHERE id = ?`, [id]);
  }
}

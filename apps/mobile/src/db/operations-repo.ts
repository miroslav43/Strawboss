import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalOperation {
  id: string;
  type: string;
  status: string;
  machine_id: string | null;
  parcel_id: string | null;
  trip_id: string | null;
  bale_count: number;
  weight_kg: number | null;
  photo_uri: string | null;
  signatures: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export interface CreateOperationInput {
  id: string;
  type: string;
  tripId?: string;
  machineId?: string;
  parcelId?: string;
}

export class OperationsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async create(op: CreateOperationInput): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO operations (id, type, trip_id, machine_id, parcel_id)
       VALUES (?, ?, ?, ?, ?)`,
      [op.id, op.type, op.tripId ?? null, op.machineId ?? null, op.parcelId ?? null]
    );
  }

  async findById(id: string): Promise<LocalOperation | null> {
    const result = await this.db.getFirstAsync<LocalOperation>(
      `SELECT * FROM operations WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async findByTripId(tripId: string): Promise<LocalOperation[]> {
    return this.db.getAllAsync<LocalOperation>(
      `SELECT * FROM operations WHERE trip_id = ? ORDER BY created_at DESC`,
      [tripId]
    );
  }

  async update(id: string, data: Partial<LocalOperation>): Promise<void> {
    const fields: string[] = [];
    const values: SQLiteBindValue[] = [];

    const updatable = [
      'status', 'machine_id', 'parcel_id', 'trip_id',
      'bale_count', 'weight_kg', 'photo_uri', 'signatures', 'server_version',
    ] as const;

    for (const key of updatable) {
      if (key in data) {
        fields.push(`${key} = ?`);
        const raw = data[key as keyof LocalOperation];
        values.push(raw != null ? (raw as SQLiteBindValue) : null);
      }
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = datetime('now')`);
    values.push(id);

    await this.db.runAsync(
      `UPDATE operations SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  async listPending(): Promise<LocalOperation[]> {
    return this.db.getAllAsync<LocalOperation>(
      `SELECT * FROM operations WHERE status = 'pending' ORDER BY created_at ASC`
    );
  }

  async listAll(): Promise<LocalOperation[]> {
    return this.db.getAllAsync<LocalOperation>(
      `SELECT * FROM operations ORDER BY created_at DESC`
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM operations WHERE id = ?`, [id]);
  }
}

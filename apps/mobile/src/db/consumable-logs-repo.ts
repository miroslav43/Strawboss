import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalConsumableLog {
  id: string;
  machine_id: string | null;
  operator_id: string;
  parcel_id: string | null;
  consumable_type: string;
  quantity: number;
  unit: string;
  logged_at: string;
  /** Local file URI captured from the camera/picker; kept for offline preview. */
  receipt_photo_uri: string | null;
  /** Public URL returned by the server after upload; this is what we sync. */
  receipt_photo_url: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class ConsumableLogsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async create(data: LocalConsumableLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO consumable_logs (
        id, machine_id, operator_id, parcel_id,
        consumable_type, quantity, unit, logged_at,
        receipt_photo_uri, receipt_photo_url,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.machine_id,
        data.operator_id,
        data.parcel_id,
        data.consumable_type,
        data.quantity,
        data.unit,
        data.logged_at,
        data.receipt_photo_uri,
        data.receipt_photo_url,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
    );
  }

  async upsert(data: LocalConsumableLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO consumable_logs (
        id, machine_id, operator_id, parcel_id,
        consumable_type, quantity, unit, logged_at,
        receipt_photo_uri, receipt_photo_url,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        machine_id = excluded.machine_id,
        operator_id = excluded.operator_id,
        parcel_id = excluded.parcel_id,
        consumable_type = excluded.consumable_type,
        quantity = excluded.quantity,
        unit = excluded.unit,
        logged_at = excluded.logged_at,
        receipt_photo_uri = excluded.receipt_photo_uri,
        receipt_photo_url = excluded.receipt_photo_url,
        updated_at = excluded.updated_at,
        server_version = excluded.server_version`,
      [
        data.id,
        data.machine_id,
        data.operator_id,
        data.parcel_id,
        data.consumable_type,
        data.quantity,
        data.unit,
        data.logged_at,
        data.receipt_photo_uri,
        data.receipt_photo_url,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
    );
  }

  /**
   * Patch the receipt URL on an existing row without changing anything else.
   * Used by the pre-push sync hook when a photo upload succeeds after the
   * original row was saved offline.
   */
  async updateReceiptUrl(id: string, url: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE consumable_logs SET receipt_photo_url = ?, updated_at = datetime('now') WHERE id = ?`,
      [url, id] as SQLiteBindValue[],
    );
  }

  async findById(id: string): Promise<LocalConsumableLog | null> {
    const result = await this.db.getFirstAsync<LocalConsumableLog>(
      `SELECT * FROM consumable_logs WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async listByOperator(operatorId: string): Promise<LocalConsumableLog[]> {
    return this.db.getAllAsync<LocalConsumableLog>(
      `SELECT * FROM consumable_logs WHERE operator_id = ? ORDER BY logged_at DESC`,
      [operatorId]
    );
  }

  async listAll(): Promise<LocalConsumableLog[]> {
    return this.db.getAllAsync<LocalConsumableLog>(
      `SELECT * FROM consumable_logs ORDER BY logged_at DESC`
    );
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM consumable_logs`
    );
    return result?.max_ver ?? 0;
  }
}

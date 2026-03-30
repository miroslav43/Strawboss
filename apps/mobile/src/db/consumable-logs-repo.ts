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
  receipt_photo_uri: string | null;
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
        receipt_photo_uri, created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        receipt_photo_uri, created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        machine_id = excluded.machine_id,
        operator_id = excluded.operator_id,
        parcel_id = excluded.parcel_id,
        consumable_type = excluded.consumable_type,
        quantity = excluded.quantity,
        unit = excluded.unit,
        logged_at = excluded.logged_at,
        receipt_photo_uri = excluded.receipt_photo_uri,
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
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
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
}

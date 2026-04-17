import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalFuelLog {
  id: string;
  machine_id: string | null;
  operator_id: string;
  parcel_id: string | null;
  logged_at: string;
  fuel_type: string;
  quantity_liters: number;
  odometer_km: number | null;
  hourmeter_hrs: number | null;
  is_full_tank: number;
  /** Local file URI captured from the camera/picker; kept for offline preview. */
  receipt_photo_uri: string | null;
  /** Public URL returned by the server after upload; this is what we sync. */
  receipt_photo_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class FuelLogsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async create(data: LocalFuelLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO fuel_logs (
        id, machine_id, operator_id, parcel_id, logged_at,
        fuel_type, quantity_liters, odometer_km, hourmeter_hrs,
        is_full_tank, receipt_photo_uri, receipt_photo_url, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.machine_id,
        data.operator_id,
        data.parcel_id,
        data.logged_at,
        data.fuel_type,
        data.quantity_liters,
        data.odometer_km,
        data.hourmeter_hrs,
        data.is_full_tank,
        data.receipt_photo_uri,
        data.receipt_photo_url,
        data.notes,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
    );
  }

  async upsert(data: LocalFuelLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO fuel_logs (
        id, machine_id, operator_id, parcel_id, logged_at,
        fuel_type, quantity_liters, odometer_km, hourmeter_hrs,
        is_full_tank, receipt_photo_uri, receipt_photo_url, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        machine_id = excluded.machine_id,
        operator_id = excluded.operator_id,
        parcel_id = excluded.parcel_id,
        logged_at = excluded.logged_at,
        fuel_type = excluded.fuel_type,
        quantity_liters = excluded.quantity_liters,
        odometer_km = excluded.odometer_km,
        hourmeter_hrs = excluded.hourmeter_hrs,
        is_full_tank = excluded.is_full_tank,
        receipt_photo_uri = excluded.receipt_photo_uri,
        receipt_photo_url = excluded.receipt_photo_url,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        server_version = excluded.server_version`,
      [
        data.id,
        data.machine_id,
        data.operator_id,
        data.parcel_id,
        data.logged_at,
        data.fuel_type,
        data.quantity_liters,
        data.odometer_km,
        data.hourmeter_hrs,
        data.is_full_tank,
        data.receipt_photo_uri,
        data.receipt_photo_url,
        data.notes,
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
      `UPDATE fuel_logs SET receipt_photo_url = ?, updated_at = datetime('now') WHERE id = ?`,
      [url, id] as SQLiteBindValue[],
    );
  }

  async findById(id: string): Promise<LocalFuelLog | null> {
    const result = await this.db.getFirstAsync<LocalFuelLog>(
      `SELECT * FROM fuel_logs WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async listByOperator(operatorId: string): Promise<LocalFuelLog[]> {
    return this.db.getAllAsync<LocalFuelLog>(
      `SELECT * FROM fuel_logs WHERE operator_id = ? ORDER BY logged_at DESC`,
      [operatorId]
    );
  }

  async listAll(): Promise<LocalFuelLog[]> {
    return this.db.getAllAsync<LocalFuelLog>(
      `SELECT * FROM fuel_logs ORDER BY logged_at DESC`
    );
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM fuel_logs`
    );
    return result?.max_ver ?? 0;
  }
}

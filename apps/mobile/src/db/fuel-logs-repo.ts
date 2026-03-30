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
  receipt_photo_uri: string | null;
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
        is_full_tank, receipt_photo_uri, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        is_full_tank, receipt_photo_uri, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        data.notes,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
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
}

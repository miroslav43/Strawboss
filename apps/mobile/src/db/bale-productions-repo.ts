import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalBaleProduction {
  id: string;
  parcel_id: string;
  baler_id: string | null;
  operator_id: string;
  production_date: string;
  bale_count: number;
  avg_bale_weight_kg: number | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class BaleProductionsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async create(data: LocalBaleProduction): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO bale_productions (
        id, parcel_id, baler_id, operator_id, production_date,
        bale_count, avg_bale_weight_kg, start_time, end_time,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.parcel_id,
        data.baler_id,
        data.operator_id,
        data.production_date,
        data.bale_count,
        data.avg_bale_weight_kg,
        data.start_time,
        data.end_time,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[],
    );
  }

  async upsert(data: LocalBaleProduction): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO bale_productions (
        id, parcel_id, baler_id, operator_id, production_date,
        bale_count, avg_bale_weight_kg, start_time, end_time,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parcel_id = excluded.parcel_id,
        baler_id = excluded.baler_id,
        operator_id = excluded.operator_id,
        production_date = excluded.production_date,
        bale_count = excluded.bale_count,
        avg_bale_weight_kg = excluded.avg_bale_weight_kg,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        updated_at = excluded.updated_at,
        server_version = excluded.server_version`,
      [
        data.id,
        data.parcel_id,
        data.baler_id,
        data.operator_id,
        data.production_date,
        data.bale_count,
        data.avg_bale_weight_kg,
        data.start_time,
        data.end_time,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[],
    );
  }

  async findById(id: string): Promise<LocalBaleProduction | null> {
    const result = await this.db.getFirstAsync<LocalBaleProduction>(
      `SELECT * FROM bale_productions WHERE id = ?`,
      [id],
    );
    return result ?? null;
  }

  async listByOperator(operatorId: string): Promise<LocalBaleProduction[]> {
    return this.db.getAllAsync<LocalBaleProduction>(
      `SELECT * FROM bale_productions WHERE operator_id = ? ORDER BY production_date DESC`,
      [operatorId],
    );
  }

  async listAll(): Promise<LocalBaleProduction[]> {
    return this.db.getAllAsync<LocalBaleProduction>(
      `SELECT * FROM bale_productions ORDER BY production_date DESC`,
    );
  }

  /**
   * FM-7: Returns the sum of bale_count for a given operator on a given
   * production_date. Used by FieldActiveNumpad to show the daily counter.
   */
  async getTodayTotalForOperator(operatorId: string, productionDate: string): Promise<number> {
    const result = await this.db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(bale_count), 0) as total
       FROM bale_productions
       WHERE operator_id = ? AND production_date = ?`,
      [operatorId, productionDate],
    );
    return result?.total ?? 0;
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM bale_productions`,
    );
    return result?.max_ver ?? 0;
  }

  /**
   * FM-4: Delete a locally-created record that has not yet been synced.
   * Called during the undo window before the sync queue entry is dispatched.
   */
  async deleteLocal(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM bale_productions WHERE id = ?`, [id]);
  }

  /**
   * FM-5: Find productions for a given parcel on a given date.
   * Used for duplicate-detection before saving a new production entry.
   */
  async findByParcelAndDate(
    parcelId: string,
    productionDate: string,
  ): Promise<LocalBaleProduction[]> {
    return this.db.getAllAsync<LocalBaleProduction>(
      `SELECT * FROM bale_productions
       WHERE parcel_id = ? AND production_date = ?
       ORDER BY created_at DESC`,
      [parcelId, productionDate],
    );
  }
}

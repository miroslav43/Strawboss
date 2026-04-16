import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalBaleLoad {
  id: string;
  trip_id: string;
  parcel_id: string;
  loader_id: string | null;
  operator_id: string | null;
  bale_count: number;
  loaded_at: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class BaleLoadsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async upsert(data: LocalBaleLoad): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO bale_loads (
        id, trip_id, parcel_id, loader_id, operator_id,
        bale_count, loaded_at, gps_lat, gps_lon, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        trip_id = excluded.trip_id,
        parcel_id = excluded.parcel_id,
        loader_id = excluded.loader_id,
        operator_id = excluded.operator_id,
        bale_count = excluded.bale_count,
        loaded_at = excluded.loaded_at,
        gps_lat = excluded.gps_lat,
        gps_lon = excluded.gps_lon,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        server_version = excluded.server_version`,
      [
        data.id,
        data.trip_id,
        data.parcel_id,
        data.loader_id,
        data.operator_id,
        data.bale_count,
        data.loaded_at,
        data.gps_lat,
        data.gps_lon,
        data.notes,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
    );
  }

  async findById(id: string): Promise<LocalBaleLoad | null> {
    const result = await this.db.getFirstAsync<LocalBaleLoad>(
      `SELECT * FROM bale_loads WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async listByTrip(tripId: string): Promise<LocalBaleLoad[]> {
    return this.db.getAllAsync<LocalBaleLoad>(
      `SELECT * FROM bale_loads WHERE trip_id = ? ORDER BY loaded_at DESC`,
      [tripId]
    );
  }

  async listAll(): Promise<LocalBaleLoad[]> {
    return this.db.getAllAsync<LocalBaleLoad>(
      `SELECT * FROM bale_loads ORDER BY loaded_at DESC`
    );
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM bale_loads`
    );
    return result?.max_ver ?? 0;
  }
}

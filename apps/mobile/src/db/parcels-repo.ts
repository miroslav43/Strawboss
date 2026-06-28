/**
 * FM-13 — Local parcel geometry cache repo.
 *
 * Stores GeoJSON boundary + metadata for parcels so MapScreen can render them
 * offline without hitting the API. Populated during pull sync.
 */
import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalParcel {
  id: string;
  name: string;
  code: string;
  area_hectares: number | null;
  municipality: string | null;
  harvest_status: string | null;
  /** T9.1 — crop label (grau / orz / rapita / plante_nutret). */
  crop_type: string | null;
  /** Denormalized owning-farm name (server migration 00065). */
  farm_name: string | null;
  /** JSON-serialised GeoJSON Point `{ type, coordinates }` or `{ lat, lon }` */
  centroid_json: string | null;
  /** JSON-serialised GeoJSON boundary (Polygon / MultiPolygon) */
  geometry: string | null;
  cached_at: string;
}

export class ParcelsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async upsert(data: LocalParcel): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO parcels (
        id, name, code, area_hectares, municipality,
        harvest_status, crop_type, farm_name, centroid_json, geometry, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name           = excluded.name,
        code           = excluded.code,
        area_hectares  = excluded.area_hectares,
        municipality   = excluded.municipality,
        harvest_status = excluded.harvest_status,
        crop_type      = excluded.crop_type,
        farm_name      = excluded.farm_name,
        centroid_json  = excluded.centroid_json,
        geometry       = excluded.geometry,
        cached_at      = excluded.cached_at`,
      [
        data.id,
        data.name,
        data.code,
        data.area_hectares,
        data.municipality,
        data.harvest_status,
        data.crop_type,
        data.farm_name,
        data.centroid_json,
        data.geometry,
        data.cached_at,
      ] as SQLiteBindValue[],
    );
  }

  async listAll(): Promise<LocalParcel[]> {
    return this.db.getAllAsync<LocalParcel>(`SELECT * FROM parcels ORDER BY name ASC`);
  }

  async listByIds(ids: string[]): Promise<LocalParcel[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return this.db.getAllAsync<LocalParcel>(
      `SELECT * FROM parcels WHERE id IN (${placeholders}) ORDER BY name ASC`,
      ids as SQLiteBindValue[],
    );
  }

  async findById(id: string): Promise<LocalParcel | null> {
    const result = await this.db.getFirstAsync<LocalParcel>(`SELECT * FROM parcels WHERE id = ?`, [
      id,
    ]);
    return result ?? null;
  }

  async updateHarvestStatus(id: string, harvestStatus: string): Promise<void> {
    await this.db.runAsync(`UPDATE parcels SET harvest_status = ? WHERE id = ?`, [
      harvestStatus,
      id,
    ] as SQLiteBindValue[]);
  }

  /** Remove parcels not updated in the last `maxAgeDays` days. */
  async pruneStale(maxAgeDays = 30): Promise<void> {
    await this.db.runAsync(`DELETE FROM parcels WHERE cached_at < datetime('now', ?)`, [
      `-${maxAgeDays} days`,
    ]);
  }

  /**
   * Drop the local row in response to a server-emitted tombstone.
   * Idempotent: deleting a missing row is a no-op.
   */
  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM parcels WHERE id = ?`, [id]);
  }
}

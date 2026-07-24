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
  /** Owning-farm id — lets the farm screen group parcels straight from the cache. */
  farm_id: string | null;
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
        harvest_status, crop_type, farm_name, farm_id, centroid_json, geometry, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name           = excluded.name,
        code           = excluded.code,
        area_hectares  = excluded.area_hectares,
        municipality   = excluded.municipality,
        harvest_status = excluded.harvest_status,
        crop_type      = excluded.crop_type,
        farm_name      = excluded.farm_name,
        farm_id        = excluded.farm_id,
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
        data.farm_id,
        data.centroid_json,
        data.geometry,
        data.cached_at,
      ] as SQLiteBindValue[],
    );
  }

  /**
   * Upsert the metadata of a parcel that arrived through delta sync, WITHOUT
   * touching its geometry.
   *
   * `/sync/pull` cannot carry geometry — the server excludes `boundary` and
   * `centroid` from PULL_COLUMNS on purpose (a raw projection would surface WKB
   * hex the mobile layer can't parse; geometry is served by the REST endpoint,
   * which runs it through ST_AsGeoJSON). The old code nonetheless read
   * `data['boundary']` here and, finding it always undefined, wrote
   * `geometry: null` — so **every pull silently erased the offline map cache**.
   * It only stayed invisible because the map re-fetched over REST on each mount
   * and painted the geometry back in. A driver with no signal got the scar: the
   * cache had the parcels but no polygons, and the map came up empty exactly
   * where there was no other way to see the field.
   *
   * The rule that prevents the whole class of bug: a writer that cannot observe
   * a column must not write it. `geometry`, `centroid_json` and `farm_id` are
   * absent from the pull payload, so they are set on INSERT (null — we have never
   * seen them, and REST will fill them in) and left alone on UPDATE.
   */
  async upsertFromPull(
    data: Omit<LocalParcel, 'geometry' | 'centroid_json' | 'farm_id'>,
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO parcels (
        id, name, code, area_hectares, municipality,
        harvest_status, crop_type, farm_name, farm_id, centroid_json, geometry, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET
        name           = excluded.name,
        code           = excluded.code,
        area_hectares  = excluded.area_hectares,
        municipality   = excluded.municipality,
        harvest_status = excluded.harvest_status,
        crop_type      = excluded.crop_type,
        farm_name      = excluded.farm_name,
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

  /**
   * Drop cached parcels the server no longer has.
   *
   * Now that the maps render from this table rather than from the API response,
   * a row that lingers here is a polygon that lingers on screen. Deletions do
   * arrive as sync tombstones, but only for a device that was online to receive
   * them — this closes the gap for one that was not.
   *
   * The rows this must NEVER touch are the ones the server has not seen yet: a
   * field drawn offline is, by definition, absent from the server list. They are
   * identified by their still-open `sync_queue` entry.
   */
  async reconcileWithServer(serverIds: string[]): Promise<void> {
    // An empty server list is far more likely to be a permissions or transport
    // fault than a real "this org has no parcels", and acting on it would wipe the
    // user's offline map. Refuse to reconcile against nothing.
    if (serverIds.length === 0) return;

    const placeholders = serverIds.map(() => '?').join(', ');
    await this.db.runAsync(
      `DELETE FROM parcels
        WHERE id NOT IN (${placeholders})
          AND id NOT IN (
            SELECT entity_id FROM sync_queue
             WHERE entity_type = 'parcel_create'
               AND status IN ('pending', 'in_flight', 'failed')
          )`,
      serverIds as SQLiteBindValue[],
    );
  }
}

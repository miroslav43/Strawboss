/**
 * Local cache + offline draft store for delivery destinations (depots).
 *
 * Populated by:
 *  - Pull sync (server snapshot of depots in the user's organization).
 *  - `handleSaveDeposit` in the geofence-maker map, which writes a draft here
 *    BEFORE enqueueing the corresponding `delivery_destinations` sync mutation.
 *
 * Mirrors ParcelsRepo's pattern. Coordinates are stored as JSON so the bridge
 * to the WebView (leaflet) can hand them off without further parsing.
 */
import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalDeliveryDestination {
  id: string;
  code: string;
  name: string;
  address: string | null;
  /** JSON-serialised GeoJSON Polygon / MultiPolygon, if a geofence was drawn. */
  boundary: string | null;
  /** JSON-serialised `{ lat, lon }` centroid. */
  coords_json: string | null;
  /**
   * Confirmation-ring radius in metres. Used to gate a depot load by proximity
   * when the depot has no drawn `boundary`. Optional: legacy callers (and rows
   * cached before this column existed) may omit it — treat absent/NULL as "no
   * radius configured".
   */
  confirm_radius_m?: number | null;
  is_default: number;
  cached_at: string;
}

export class DeliveryDestinationsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async upsert(data: LocalDeliveryDestination): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO delivery_destinations (
        id, code, name, address, boundary, coords_json, confirm_radius_m, is_default, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code             = excluded.code,
        name             = excluded.name,
        address          = excluded.address,
        boundary         = excluded.boundary,
        coords_json      = excluded.coords_json,
        confirm_radius_m = excluded.confirm_radius_m,
        is_default       = excluded.is_default,
        cached_at        = excluded.cached_at`,
      [
        data.id,
        data.code,
        data.name,
        data.address,
        data.boundary,
        data.coords_json,
        data.confirm_radius_m ?? null,
        data.is_default,
        data.cached_at,
      ] as SQLiteBindValue[],
    );
  }

  async listAll(): Promise<LocalDeliveryDestination[]> {
    return this.db.getAllAsync<LocalDeliveryDestination>(
      `SELECT * FROM delivery_destinations ORDER BY name ASC`,
    );
  }

  async findById(id: string): Promise<LocalDeliveryDestination | null> {
    const result = await this.db.getFirstAsync<LocalDeliveryDestination>(
      `SELECT * FROM delivery_destinations WHERE id = ?`,
      [id],
    );
    return result ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM delivery_destinations WHERE id = ?`, [id]);
  }
}

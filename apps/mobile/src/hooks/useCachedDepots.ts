/**
 * useCachedDepots — depot (delivery_destinations) geometry cache.
 *
 * Mirrors `useCachedParcels`: fetches the depot list from the API when online
 * and falls back to the local SQLite cache when offline / on error. After a
 * successful fetch it persists each depot's geometry (boundary polygon + point
 * coords + confirm radius) into the local `delivery_destinations` table so
 * in-depot presence (`useCurrentLoaderParcel`), the driver's destination
 * proximity, and geofence-wake can read it offline.
 *
 * This restores the intended REST-cache path — before this, nothing wrote
 * server depot geometry into SQLite (the table is excluded from delta sync and
 * `DeliveryDestinationsRepo.upsert` had no callers), so depot presence was stuck
 * on "unknown" forever.
 */
import { useEffect, useState } from 'react';
import type { DeliveryDestination } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import {
  DeliveryDestinationsRepo,
  type LocalDeliveryDestination,
} from '@/db/delivery-destinations-repo';
import { mobileLogger } from '@/lib/logger';

/**
 * The backend serialises coords with PostGIS `ST_AsGeoJSON(...)::json`, so we
 * receive a GeoJSON Point `{ type: 'Point', coordinates: [lon, lat] }` even
 * though the type models it as `{ lat, lon }`. Accept both and return the
 * `{ lat, lon }` JSON string that `computeDepotPresence` expects (or null).
 */
function coordsToJson(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as { lat?: unknown; lon?: unknown; coordinates?: unknown };
  if (typeof obj.lat === 'number' && typeof obj.lon === 'number') {
    return JSON.stringify({ lat: obj.lat, lon: obj.lon });
  }
  if (Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
    const [lon, lat] = obj.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number') {
      return JSON.stringify({ lat, lon });
    }
  }
  return null;
}

/** boundary arrives as a GeoJSON object (or occasionally a string); store a string. */
function boundaryToString(raw: unknown): string | null {
  if (raw == null) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

function apiDepotToLocal(d: DeliveryDestination): LocalDeliveryDestination {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    address: d.address ?? null,
    boundary: boundaryToString(d.boundary),
    coords_json: coordsToJson(d.coords),
    confirm_radius_m: d.confirmRadiusM ?? null,
    is_default: d.isDefault ? 1 : 0,
    cached_at: new Date().toISOString(),
  };
}

async function persistDepotsToCache(depots: LocalDeliveryDestination[]): Promise<void> {
  try {
    const db = await getDatabase();
    const repo = new DeliveryDestinationsRepo(db);
    for (const d of depots) {
      await repo.upsert(d);
    }
  } catch (err) {
    mobileLogger.warn('useCachedDepots: failed to persist depots to SQLite', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadDepotsFromCache(): Promise<LocalDeliveryDestination[]> {
  try {
    const db = await getDatabase();
    const repo = new DeliveryDestinationsRepo(db);
    return await repo.listAll();
  } catch {
    return [];
  }
}

export interface UseCachedDepotsResult {
  depots: LocalDeliveryDestination[];
  loading: boolean;
  /** True when data came from the local cache (offline fallback). */
  fromCache: boolean;
}

/**
 * Returns the depot list from API (online) or SQLite cache (offline), updating
 * the cache after each successful fetch. Poll cadence is gentle — depot geometry
 * is near-static.
 */
export function useCachedDepots(pollMs = 5 * 60_000): UseCachedDepotsResult {
  const [depots, setDepots] = useState<LocalDeliveryDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const apiDepots = await mobileApiClient.get<DeliveryDestination[]>(
          '/api/v1/delivery-destinations',
        );
        if (cancelled) return;
        const mapped = apiDepots.map(apiDepotToLocal);
        setDepots(mapped);
        setFromCache(false);
        void persistDepotsToCache(mapped);
      } catch {
        if (cancelled) return;
        const cached = await loadDepotsFromCache();
        if (cancelled) return;
        setDepots(cached);
        setFromCache(true);
        if (cached.length > 0) {
          mobileLogger.flow('useCachedDepots: offline, loaded from SQLite cache', {
            count: cached.length,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  return { depots, loading, fromCache };
}

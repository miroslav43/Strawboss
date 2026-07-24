/**
 * useCachedDepots — the depot (delivery_destinations) list the maps render.
 *
 * Local-first, mirroring `useCachedParcels`: the SQLite `delivery_destinations`
 * table is the source of truth for what gets drawn, and the REST endpoint is a
 * background refresher that writes into it. A depot drawn by the geofence-maker
 * is therefore on the map immediately, offline included, instead of waiting for
 * the sync queue to reach the server and a remount to happen to coincide.
 *
 * The cache also feeds in-depot presence (`useCurrentLoaderParcel`), the driver's
 * destination proximity, and geofence-wake — all of which need it offline.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeliveryDestination } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import {
  DeliveryDestinationsRepo,
  type LocalDeliveryDestination,
} from '@/db/delivery-destinations-repo';

/** What the maps read. Invalidate after any local write to `delivery_destinations`. */
export const DEPOTS_LOCAL_KEY = ['depots-local'] as const;
/** The background server refresh. */
export const DEPOTS_REFRESH_KEY = ['depots-remote-refresh'] as const;

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

export async function persistDepotsToCache(depots: DeliveryDestination[]): Promise<void> {
  const db = await getDatabase();
  const repo = new DeliveryDestinationsRepo(db);
  // Depots never travel on delta sync, so this is the only channel through which a
  // device can learn that one was deleted. See DeliveryDestinationsRepo.reconcileWithServer.
  await repo.reconcileWithServer(depots.map((d) => d.id));
  for (const d of depots) {
    await repo.upsert(apiDepotToLocal(d));
  }
}

async function readDepotsFromSqlite(): Promise<LocalDeliveryDestination[]> {
  const db = await getDatabase();
  const repo = new DeliveryDestinationsRepo(db);
  return repo.listAll();
}

export interface UseCachedDepotsResult {
  depots: LocalDeliveryDestination[];
  loading: boolean;
  /** True until the server has confirmed the list at least once this session. */
  fromCache: boolean;
}

export function useCachedDepots(refreshMs = 5 * 60_000): UseCachedDepotsResult {
  const queryClient = useQueryClient();

  // See useCachedParcels for why `networkMode: 'always'` matters on the local read.
  const local = useQuery({
    queryKey: DEPOTS_LOCAL_KEY,
    queryFn: readDepotsFromSqlite,
    staleTime: Infinity,
    networkMode: 'always',
  });

  // Depot geometry is near-static, so the refresh cadence stays gentle.
  const refresh = useQuery({
    queryKey: DEPOTS_REFRESH_KEY,
    queryFn: async () => {
      const server = await mobileApiClient.get<DeliveryDestination[]>(
        '/api/v1/delivery-destinations',
      );
      await persistDepotsToCache(server);
      await queryClient.invalidateQueries({ queryKey: DEPOTS_LOCAL_KEY });
      return server.length;
    },
    staleTime: refreshMs,
    retry: false,
  });

  return {
    depots: local.data ?? [],
    loading: local.isPending,
    fromCache: !refresh.isSuccess,
  };
}

/**
 * useCachedParcels — the parcel list the maps render.
 *
 * **Local-first.** The local SQLite `parcels` table is the source of truth for
 * what gets drawn; the REST endpoint is a background refresher that writes into
 * it. Two consequences, both of them the point:
 *
 *  - A parcel the geofence-maker just drew is on the map in the same frame as
 *    the success modal, with no network involved. Previously this hook fetched
 *    the server list first, which of course did not contain the parcel yet, and
 *    the freshly drawn field vanished until a sync cycle (up to 15 minutes) and
 *    a remount happened to coincide.
 *  - A driver with no signal renders instantly from the cache instead of waiting
 *    out an HTTP timeout before falling back to it.
 *
 * The old shape was a bare `useEffect` with a `[]` dep array: network-first,
 * fetched once per mount, and invisible to every `invalidateQueries` call in the
 * app — so nothing could ever tell it that the data had changed. It is now two
 * React Query queries, which makes it addressable.
 *
 * The server list can never delete a locally-pending row: `persistParcelsToCache`
 * only upserts, `pruneStale` deletes by age (a new row's `cached_at` is now), and
 * a tombstone cannot name a parcel the server has not seen. Keep it that way.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Parcel } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { ParcelsRepo, type LocalParcel } from '@/db/parcels-repo';

/** What the maps read. Invalidate this after any local write to `parcels`. */
export const PARCELS_LOCAL_KEY = ['parcels-local'] as const;
/** The background server refresh. Invalidate to pull authoritative values sooner. */
export const PARCELS_REFRESH_KEY = ['parcels-remote-refresh'] as const;

export interface CachedParcel {
  id: string;
  name: string;
  code: string;
  areaHectares: number | null;
  municipality: string | null;
  harvestStatus: string | null;
  /** T9.1 crop label (grau / orz / rapita / plante_nutret / altele) or null. */
  cropType: string | null;
  /** Denormalized owning-farm name (server 00065) or null. */
  farmName: string | null;
  /** Owning-farm id — what the farm screen groups by. */
  farmId: string | null;
  boundary: unknown | null;
  centroid: unknown | null;
}

function localParcelToCached(p: LocalParcel): CachedParcel {
  let boundary: unknown = null;
  if (p.geometry) {
    try {
      boundary = JSON.parse(p.geometry) as unknown;
    } catch {
      boundary = null;
    }
  }
  let centroid: unknown = null;
  if (p.centroid_json) {
    try {
      centroid = JSON.parse(p.centroid_json) as unknown;
    } catch {
      centroid = null;
    }
  }
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    areaHectares: p.area_hectares,
    municipality: p.municipality,
    harvestStatus: p.harvest_status,
    cropType: p.crop_type,
    farmName: p.farm_name,
    farmId: p.farm_id,
    boundary,
    centroid,
  };
}

export async function persistParcelsToCache(parcels: Parcel[]): Promise<void> {
  const db = await getDatabase();
  const repo = new ParcelsRepo(db);
  const now = new Date().toISOString();
  // The server list is authoritative for what EXISTS, so drop anything it no longer
  // carries — otherwise a parcel deleted on the web would stay painted on the map.
  // Rows still queued for push are exempt (they are absent from the server list
  // because they have not reached the server yet, not because they were deleted).
  await repo.reconcileWithServer(parcels.map((p) => p.id));
  for (const p of parcels) {
    await repo.upsert({
      id: p.id,
      // local parcels.name is NOT NULL — coalesce to code for unnamed terrains.
      name: (p.name as string | null) ?? p.code,
      code: p.code,
      area_hectares: p.areaHectares ?? null,
      municipality: p.municipality ?? null,
      harvest_status: p.harvestStatus ?? null,
      crop_type: p.cropType ?? null,
      // 00065 — denormalized farm name for the offline field card.
      farm_name: p.farmName ?? null,
      farm_id: p.farmId ?? null,
      centroid_json: p.centroid ? JSON.stringify(p.centroid) : null,
      geometry: p.boundary ? JSON.stringify(p.boundary) : null,
      cached_at: now,
    });
  }
}

async function readParcelsFromSqlite(): Promise<CachedParcel[]> {
  const db = await getDatabase();
  const repo = new ParcelsRepo(db);
  const rows = await repo.listAll();
  return rows.map(localParcelToCached);
}

export interface UseCachedParcelsResult {
  parcels: CachedParcel[];
  /** True while the first read of the local cache is in flight. */
  loading: boolean;
  /** True until the server has confirmed the list at least once this session. */
  fromCache: boolean;
}

export function useCachedParcels(): UseCachedParcelsResult {
  const queryClient = useQueryClient();

  // 1. What gets drawn. Instant, offline, and it includes rows that have not
  //    reached the server yet. `networkMode: 'always'` is load-bearing: this
  //    query touches no network, and React Query's default 'online' mode would
  //    PAUSE it whenever the app is offline — starving the map of the cache
  //    precisely when the cache is the only thing left.
  const local = useQuery({
    queryKey: PARCELS_LOCAL_KEY,
    queryFn: readParcelsFromSqlite,
    staleTime: Infinity,
    networkMode: 'always',
  });

  // 2. The background refresher. Its failure is a non-event — offline just means
  //    the map keeps showing the cache. On success it writes the server's
  //    authoritative values (PostGIS area, farm_name) into SQLite and re-reads.
  const refresh = useQuery({
    queryKey: PARCELS_REFRESH_KEY,
    queryFn: async () => {
      const server = await mobileApiClient.get<Parcel[]>('/api/v1/parcels');
      await persistParcelsToCache(server);
      await queryClient.invalidateQueries({ queryKey: PARCELS_LOCAL_KEY });
      return server.length;
    },
    staleTime: 60_000,
    retry: false,
  });

  return {
    parcels: local.data ?? [],
    loading: local.isPending,
    fromCache: !refresh.isSuccess,
  };
}

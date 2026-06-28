/**
 * FM-13 — useCachedParcels
 *
 * Fetches parcel list from the API when online; falls back to the local SQLite
 * cache when offline or when the API call fails. After a successful API fetch,
 * writes the geometry into the local `parcels` table so the next offline
 * session can render the map without a network connection.
 */
import { useEffect, useState } from 'react';
import type { Parcel } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { ParcelsRepo, type LocalParcel } from '@/db/parcels-repo';
import { mobileLogger } from '@/lib/logger';

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
  boundary: unknown | null;
  centroid: unknown | null;
}

function apiParcelToCached(p: Parcel): CachedParcel {
  return {
    id: p.id,
    // Parcel.name is typed string but the API can return null for unnamed
    // terrains; fall back to the code so it still renders and caches (the local
    // SQLite parcels.name is NOT NULL — a null here crashed the cache write).
    name: (p.name as string | null) ?? p.code,
    code: p.code,
    areaHectares: p.areaHectares ?? null,
    municipality: p.municipality ?? null,
    harvestStatus: p.harvestStatus ?? null,
    cropType: p.cropType ?? null,
    farmName: p.farmName ?? null,
    boundary: p.boundary ?? null,
    centroid: p.centroid ?? null,
  };
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
    boundary,
    centroid,
  };
}

async function persistParcelsToCache(parcels: Parcel[]): Promise<void> {
  try {
    const db = await getDatabase();
    const repo = new ParcelsRepo(db);
    const now = new Date().toISOString();
    for (const p of parcels) {
      await repo.upsert({
        id: p.id,
        // local parcels.name is NOT NULL — coalesce to code for unnamed terrains.
        name: (p.name as string | null) ?? p.code,
        code: p.code,
        area_hectares: p.areaHectares ?? null,
        municipality: p.municipality ?? null,
        harvest_status: p.harvestStatus ?? null,
        // T9.1 — crop_type is nullable on storage; pass through if present.
        crop_type: p.cropType ?? null,
        // 00065 — denormalized farm name for the offline field card.
        farm_name: p.farmName ?? null,
        centroid_json: p.centroid ? JSON.stringify(p.centroid) : null,
        geometry: p.boundary ? JSON.stringify(p.boundary) : null,
        cached_at: now,
      });
    }
  } catch (err) {
    mobileLogger.warn('useCachedParcels: failed to persist parcels to SQLite', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadParcelsFromCache(): Promise<CachedParcel[]> {
  try {
    const db = await getDatabase();
    const repo = new ParcelsRepo(db);
    const rows = await repo.listAll();
    return rows.map(localParcelToCached);
  } catch {
    return [];
  }
}

export interface UseCachedParcelsResult {
  parcels: CachedParcel[];
  /** True while the initial load (API or cache) is in progress */
  loading: boolean;
  /** True when data was loaded from local cache (offline fallback) */
  fromCache: boolean;
}

/**
 * Returns parcel list from API (online) or SQLite cache (offline).
 * Transparently updates the cache after each successful API fetch.
 */
export function useCachedParcels(): UseCachedParcelsResult {
  const [parcels, setParcels] = useState<CachedParcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Attempt online fetch first
        const apiParcels = await mobileApiClient.get<Parcel[]>('/api/v1/parcels');
        if (cancelled) return;
        const mapped = apiParcels.map(apiParcelToCached);
        setParcels(mapped);
        setFromCache(false);
        // Persist to SQLite in the background — non-blocking
        void persistParcelsToCache(apiParcels);
      } catch {
        if (cancelled) return;
        // API failed — fall back to local cache
        const cached = await loadParcelsFromCache();
        if (cancelled) return;
        setParcels(cached);
        setFromCache(true);
        if (cached.length > 0) {
          mobileLogger.flow('useCachedParcels: offline, loaded from SQLite cache', {
            count: cached.length,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { parcels, loading, fromCache };
}

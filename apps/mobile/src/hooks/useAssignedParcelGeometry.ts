/**
 * useAssignedParcelGeometry — guarantees the operator's own fields for today
 * have their outlines cached locally, because GPS field resolution is useless
 * without them.
 *
 * **Why this exists.** `parcels.geometry` in SQLite is written by exactly one
 * path: the bulk REST refresh in `useCachedParcels` (`GET /api/v1/parcels` →
 * `persistParcelsToCache`). The delta-sync path deliberately does not write it
 * — `PULL_COLUMNS.parcels` omits `boundary`/`centroid` because a raw projection
 * would surface WKB hex, so `ParcelsRepo.upsertFromPull` inserts NULL geometry
 * and never touches it on update. A parcel first learned about through sync
 * (assigned mid-day, or a phone whose bulk refresh has never once succeeded)
 * therefore has a row with no polygon.
 *
 * `pickSmallestContainingParcel` silently drops boundary-less parcels from
 * matching. The consequence is asymmetric and was invisible for a long time:
 * the single-assigned-field shortcut in `useCurrentLoaderParcel` resolves
 * without consulting geometry at all, so a one-field operator never noticed —
 * while an operator with two or more fields had *nothing* for GPS to match
 * against and could not register a load at all.
 *
 * **Why per-id and not the bulk list.** `GET /api/v1/parcels` is the whole
 * organisation (357 parcels ≈ 529 kB of GeoJSON in production) and is exactly
 * what has already failed for a phone in this state. `GET /api/v1/parcels/:id`
 * returns the same `ST_AsGeoJSON` boundary for one field (~1.5 kB), and a day's
 * assignment is 1–14 fields. Repairing what today actually needs is both far
 * likelier to succeed on a weak connection and in keeping with the fleet's
 * traffic diet.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Parcel } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { ParcelsRepo } from '@/db/parcels-repo';
import { PARCELS_LOCAL_KEY } from './useCachedParcels';
import { mobileLogger } from '@/lib/logger';

/**
 * Ids that have no usable polygon cached — either the row is absent entirely or
 * its `geometry` is NULL/empty. `listByIds` only returns rows that exist, so
 * both cases fall out of the same set difference.
 */
async function findIdsMissingGeometry(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = await getDatabase();
  const rows = await new ParcelsRepo(db).listByIds(ids);
  const haveGeometry = new Set(
    rows.filter((r) => r.geometry != null && r.geometry !== '').map((r) => r.id),
  );
  return ids.filter((id) => !haveGeometry.has(id));
}

async function repairGeometry(ids: string[]): Promise<number> {
  const missing = await findIdsMissingGeometry(ids);
  if (missing.length === 0) return 0;

  mobileLogger.flow('useAssignedParcelGeometry: repairing missing field outlines', {
    assigned: ids.length,
    missing: missing.length,
  });

  const fetched = await Promise.all(
    missing.map((id) =>
      mobileApiClient.get<Parcel>(`/api/v1/parcels/${id}`).catch(() => {
        // One field failing must not abandon the others — the operator may well
        // be standing in one of the ones that did come back.
        return null;
      }),
    ),
  );

  const db = await getDatabase();
  const repo = new ParcelsRepo(db);
  const now = new Date().toISOString();
  let repaired = 0;

  for (const p of fetched) {
    if (!p || !p.boundary) continue;
    // Deliberately `repo.upsert` per row, NOT `persistParcelsToCache`: that
    // helper calls `reconcileWithServer(ids)`, which deletes every local parcel
    // absent from the list it is handed. Passing it this partial list would
    // wipe every other cached field off the phone.
    await repo.upsert({
      id: p.id,
      // The local `name` column is NOT NULL; unnamed terrains fall back to code.
      name: (p.name as string | null) ?? p.code,
      code: p.code,
      area_hectares: p.areaHectares ?? null,
      municipality: p.municipality ?? null,
      harvest_status: p.harvestStatus ?? null,
      crop_type: p.cropType ?? null,
      farm_name: p.farmName ?? null,
      farm_id: p.farmId ?? null,
      centroid_json: p.centroid ? JSON.stringify(p.centroid) : null,
      geometry: JSON.stringify(p.boundary),
      cached_at: now,
    });
    repaired++;
  }

  mobileLogger.flow('useAssignedParcelGeometry: repair finished', {
    requested: missing.length,
    repaired,
    failed: missing.length - repaired,
  });

  return repaired;
}

export interface UseAssignedParcelGeometryResult {
  /** True while outlines are being fetched, so the screen can say so. */
  isRepairing: boolean;
  /** Re-attempt the fetch — bound to the "download outlines" button. */
  retry: () => void;
}

export function useAssignedParcelGeometry(
  assignedParcelIds: string[],
): UseAssignedParcelGeometryResult {
  const queryClient = useQueryClient();
  // Sorted + joined so the 1–3 mounted copies of the resolver (loader home,
  // baler home, load screen) share one query instead of racing three.
  const key = [...assignedParcelIds].sort().join(',');

  const query = useQuery({
    queryKey: ['parcel-geometry-backfill', key],
    queryFn: async () => {
      const repaired = await repairGeometry(assignedParcelIds);
      if (repaired > 0) {
        await queryClient.invalidateQueries({ queryKey: PARCELS_LOCAL_KEY });
      }
      return repaired;
    },
    enabled: assignedParcelIds.length > 0,
    staleTime: 60_000,
    retry: 1,
    // Never pause this offline: it must be free to fail fast so the screen can
    // show the "no signal" branch, rather than hanging in a paused state.
    networkMode: 'always',
  });

  const retry = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: ['parcel-geometry-backfill', key] });
  }, [queryClient, key]);

  return { isRepairing: query.isFetching, retry };
}

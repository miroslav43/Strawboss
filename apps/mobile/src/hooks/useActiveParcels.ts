/**
 * useActiveParcels — GPS/geofence-matching view over the parcel cache.
 *
 * Historically this fetched `GET /api/v1/parcels?isActive=true` directly over
 * the network with no offline fallback: offline, `data` stayed `undefined`
 * forever, and every screen gated on it (load-bales, ProductionNumpad,
 * FieldActiveNumpad) got stuck on "position unknown" instead of falling back
 * to the parcel cache that `useCachedParcels` already maintains in SQLite.
 *
 * Two things make folding this into `useCachedParcels` safe:
 *  - The server's `isActive=true` filter is a no-op today
 *    (`parcels.service.ts` T9.2 — "accepted for backward-compat but ignored:
 *    all non-soft-deleted parcels are now considered active"). So this hook
 *    and `useCachedParcels` were always requesting the identical row set
 *    through two independent code paths — one held only in memory (and died
 *    offline), the other persisted to SQLite (and survives offline). No
 *    `isActive` semantics are lost by reusing the SQLite-backed one.
 *  - Rows with no boundary are intentionally KEPT here, not filtered out.
 *    `pickSmallestContainingParcel` already skips them, and `computePresence`
 *    (`useCurrentLoaderParcel.ts`) needs the row present to tell "this parcel
 *    has no polygon cached (yet)" apart from "this isn't one of your
 *    parcels" — exactly the distinction the degraded-mode gate relies on.
 */
import { useMemo } from 'react';
import { useCachedParcels } from './useCachedParcels';
import { pickSmallestContainingParcel, PARCEL_MATCH_TOLERANCE_M } from '@/lib/point-in-geojson';

/** Row shape consumed by the geofence-matching call sites. */
export interface ActiveParcel {
  id: string;
  code: string;
  name: string;
  areaHectares: number;
  boundary: unknown;
}

export interface UseActiveParcelsResult {
  data: ActiveParcel[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** True until the server has confirmed the parcel list at least once this session. */
  fromCache: boolean;
}

export function useActiveParcels(): UseActiveParcelsResult {
  const { parcels, loading, fromCache } = useCachedParcels();

  const data = useMemo<ActiveParcel[]>(
    () =>
      parcels.map((p) => ({
        id: p.id,
        code: p.code,
        // A parcel with no name must NOT be dropped (it would vanish from GPS
        // parcel matching and block production entry — a documented past
        // incident). The persist layer (`useCachedParcels.ts`,
        // `persistParcelsToCache`) already coalesces `name ?? code` before
        // writing SQLite, and the local column is NOT NULL, so `p.name` is
        // never empty here. Do not re-add a name-or-code fallback at this
        // layer — it would silently mask a broken cache write instead of
        // surfacing it.
        name: p.name,
        areaHectares: p.areaHectares ?? 0,
        boundary: p.boundary,
      })),
    [parcels],
  );

  return {
    data,
    // True only for the first, near-instant SQLite read — this never blocks
    // on the network. `useCachedParcels`'s background REST refresh failing
    // (e.g. offline) is not an error from this hook's point of view: the
    // cache is the source of truth, and its staleness is exactly the
    // "no_geometry" / "no_data" case the gate callers already branch on via
    // `boundary == null`.
    isLoading: loading,
    isError: false,
    fromCache,
  };
}

/**
 * Among active parcels whose boundary contains (lon, lat), return the one with
 * the smallest areaHectares (tie-break: stable order by name).
 */
export function findParcelAtLocation(
  lon: number,
  lat: number,
  parcels: ActiveParcel[],
): ActiveParcel | null {
  // Match within a GPS-tolerance buffer so edge/drift positions still resolve.
  return pickSmallestContainingParcel(lon, lat, parcels, PARCEL_MATCH_TOLERANCE_M);
}

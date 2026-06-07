import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { pickSmallestContainingParcel, PARCEL_MATCH_TOLERANCE_M } from '@/lib/point-in-geojson';

export const ACTIVE_PARCELS_QUERY_KEY = ['parcels', 'active'] as const;

/** Row shape from GET /api/v1/parcels (camelCase aliases from backend). */
export interface ActiveParcel {
  id: string;
  code: string;
  name: string;
  areaHectares: number;
  boundary: unknown;
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row: Record<string, unknown>): ActiveParcel | null {
  const id = row.id;
  if (typeof id !== 'string') return null;
  const code = typeof row.code === 'string' ? row.code : '';
  // A parcel with no name must NOT be dropped (it would vanish from GPS parcel
  // matching, blocking production entry). Fall back to the code as the display
  // name; only skip a parcel that has neither name nor code.
  const rawName = typeof row.name === 'string' && row.name.trim() !== '' ? row.name : null;
  const name = rawName ?? code;
  if (name === '') return null;
  return {
    id,
    code,
    name,
    areaHectares: toNum(row.areaHectares),
    boundary: row.boundary ?? null,
  };
}

export async function fetchActiveParcels(): Promise<ActiveParcel[]> {
  const rows = await mobileApiClient.get<Record<string, unknown>[]>(
    '/api/v1/parcels?isActive=true',
  );
  const list = rows ?? [];
  const out: ActiveParcel[] = [];
  for (const r of list) {
    const p = normalizeRow(r);
    if (p) out.push(p);
  }
  return out;
}

export function useActiveParcels() {
  return useQuery<ActiveParcel[]>({
    queryKey: ACTIVE_PARCELS_QUERY_KEY,
    queryFn: fetchActiveParcels,
  });
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

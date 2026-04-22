import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { pickSmallestContainingParcel } from '@/lib/point-in-geojson';

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
  const name = row.name;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return {
    id,
    code: typeof row.code === 'string' ? row.code : '',
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
  return pickSmallestContainingParcel(lon, lat, parcels);
}

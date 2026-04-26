import { useQuery } from '@tanstack/react-query';
import type { Machine } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { getDatabase } from '@/lib/storage';
import { BaleLoadsRepo } from '@/db/bale-loads-repo';

export interface TripToLoad {
  id: string;
  tripNumber: string | null;
  status: string;
  /** UUID of the truck (Machine). */
  truckId: string | null;
  sourceParcelId: string | null;
  /** Total bale_count accumulated on the trip so far. */
  baleCount: number;
  /** Populated in a second pass once `/machines/:id` responds. */
  truckPlate: string | null;
  truckCode: string | null;
  /** Populated in a second pass once `/parcels/:id` responds. */
  sourceParcelName: string | null;
  sourceParcelCode: string | null;
}

interface RawTrip {
  id: string;
  trip_number: string | null;
  status: string;
  truck_id: string | null;
  source_parcel_id: string | null;
  bale_count: number | string | null;
}

interface RawParcel {
  id: string;
  name: string;
  code: string;
}

function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Fetches the trips assigned to the current user as loader_operator for today,
 * then enriches each trip with the truck plate and parcel name via parallel
 * machine / parcel lookups.
 *
 * Refetches every 60 s so that newly created trips (dispatched by admin)
 * appear without a manual pull-to-refresh.
 */
export function useMyTrucksToLoad() {
  const userId = useAuthStore((s) => s.userId);

  return useQuery<TripToLoad[]>({
    queryKey: ['trips-to-load', userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const trips = await mobileApiClient.get<RawTrip[]>(
        `/api/v1/trips?loaderOperatorId=${userId}&status=planned,loading,loaded&dateFrom=${todayStart()}`,
      );

      if (!trips?.length) return [];

      // Collect unique truck and parcel IDs to look up in parallel
      const truckIds = [...new Set(trips.map((t) => t.truck_id).filter(Boolean) as string[])];
      const parcelIds = [...new Set(trips.map((t) => t.source_parcel_id).filter(Boolean) as string[])];

      const db = await getDatabase();
      const baleLoadsRepo = new BaleLoadsRepo(db);

      const [machines, parcels, localSums] = await Promise.all([
        Promise.all(
          truckIds.map((id) =>
            mobileApiClient
              .get<Machine>(`/api/v1/machines/${id}`)
              .catch(() => null),
          ),
        ),
        Promise.all(
          parcelIds.map((id) =>
            mobileApiClient
              .get<RawParcel>(`/api/v1/parcels/${id}`)
              .catch(() => null),
          ),
        ),
        // Optimistic overlay: how many bales we've persisted locally per trip.
        Promise.all(
          trips.map((t) =>
            baleLoadsRepo.sumByTrip(t.id).catch(() => 0),
          ),
        ),
      ]);

      // Build lookup maps
      const machineMap = new Map<string, Machine>();
      for (const m of machines) {
        if (m) machineMap.set(m.id, m);
      }
      const parcelMap = new Map<string, RawParcel>();
      for (const p of parcels) {
        if (p) parcelMap.set(p.id, p);
      }

      return trips.map<TripToLoad>((t, idx) => {
        const machine = t.truck_id ? machineMap.get(t.truck_id) : undefined;
        const parcel = t.source_parcel_id ? parcelMap.get(t.source_parcel_id) : undefined;
        const serverCount = Number(t.bale_count ?? 0);
        const localCount = localSums[idx] ?? 0;
        // After sync the two values converge; before sync, local > server.
        // Taking the max avoids under- or double-counting either way.
        const effectiveCount = Math.max(serverCount, localCount);
        return {
          id: t.id,
          tripNumber: t.trip_number ?? null,
          status: t.status,
          truckId: t.truck_id ?? null,
          sourceParcelId: t.source_parcel_id ?? null,
          baleCount: effectiveCount,
          truckPlate: machine?.registrationPlate ?? null,
          truckCode: machine?.internalCode ?? null,
          sourceParcelName: parcel?.name ?? null,
          sourceParcelCode: parcel?.code ?? null,
        };
      });
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { mobileLogger } from '@/lib/logger';

/**
 * How often the depot board re-reads the server, matching the loader board's
 * 15 s poll.
 *
 * There used to be no interval at all: `staleTime: 60s` and nothing to trigger a
 * refetch, so the list only moved when the operator remembered to pull down. A
 * truck could arrive, park, and sit at the ramp without ever appearing — which
 * is indistinguishable from the feature not existing.
 */
const DEPOT_POLL_MS = 15_000;

/** One inbound truck as the depot operator sees it. Mirrors DepotIncomingTruck. */
export interface DepotIncomingTruck {
  tripId: string;
  tripNumber: string;
  status: string;
  truckId: string | null;
  baleCount: number;
  iterationIndex: number | null;
  truckPlate: string | null;
  truckCode: string | null;
  driverName: string | null;
  /** Metres from the truck's latest GPS fix to the depot; null if no recent fix. */
  distanceM: number | null;
  /** True when the truck is within the depot's confirm geofence. */
  isInsideGeofence: boolean;
  /** True while the trip is still open at this depot (every listed truck). */
  awaitingConfirmation: boolean;
  /**
   * False when the trip reached this list by proximity alone — its
   * `destination_id` is NULL. Acting on it adopts it, but only with real GPS
   * inside the perimeter: the server refuses to adopt on an override.
   */
  destinationLinked: boolean;
  /** Set once "Începe descărcarea" was pressed; null before that. */
  unloadStartedAt: string | null;
  lastSeenAt: string | null;
}

/**
 * Which depot the operator is looking at.
 *
 * `trips.tsx` and `confirm-delivery.tsx` each hardcoded `depots[0]`, ignoring the
 * picker on the inventory tab — a multi-depot user selecting their second depot
 * still got the first one's trucks. A `depot_manager` is scoped server-side to a
 * single depot so it never bit them, but an admin sees the whole org.
 */
interface SelectedDepotState {
  selectedDepotId: string | null;
  setSelectedDepotId: (id: string | null) => void;
}
export const useSelectedDepotStore = create<SelectedDepotState>((set) => ({
  selectedDepotId: null,
  setSelectedDepotId: (id) => set({ selectedDepotId: id }),
}));

/** The depot in context: the operator's pick, else the first available. */
export function useActiveDepotId(): string | null {
  const selected = useSelectedDepotStore((s) => s.selectedDepotId);
  const { data: depots } = useDepotList();
  return selected ?? depots?.[0]?.id ?? null;
}

export interface DepotInventoryPayload {
  depot: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    coordsGeoJson: string | null;
    /** 'temporary' depots take only a bale count; 'principal' also take weights. */
    depotType: 'principal' | 'temporary';
    /** Geofence radius (m) within which the operator may confirm an arriving truck. */
    confirmRadiusM: number;
  };
  inventory: {
    totalBales: number;
    totalNetWeightKg: number;
    lastUpdate: string | null;
  };
  incoming: DepotIncomingTruck[];
}

export interface DepotOption {
  id: string;
  code: string;
  name: string;
  address?: string | null;
}

async function readCache(depotId: string): Promise<DepotInventoryPayload | null> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ payload: string; fetched_at: string }>(
      `SELECT payload, fetched_at FROM deposit_inventory_cache WHERE depot_id = ?`,
      [depotId],
    );
    return row ? (JSON.parse(row.payload) as DepotInventoryPayload) : null;
  } catch (err) {
    mobileLogger.warn('readCache deposit_inventory_cache failed', { err });
    return null;
  }
}

async function writeCache(depotId: string, payload: DepotInventoryPayload): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO deposit_inventory_cache (depot_id, payload, fetched_at)
       VALUES (?, ?, datetime('now'))`,
      [depotId, JSON.stringify(payload)],
    );
  } catch (err) {
    mobileLogger.warn('writeCache deposit_inventory_cache failed', { err });
  }
}

/** Plan C — list of depots in the user's org. Used to pick when more than one. */
export function useDepotList() {
  return useQuery<DepotOption[]>({
    queryKey: ['deposit-inventory', 'depots'],
    queryFn: async () => {
      const data = await mobileApiClient.get<unknown>('/api/v1/deposit-inventory/depots');
      const list = Array.isArray(data) ? data : ((data as { rows?: unknown }).rows ?? []);
      return list as DepotOption[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Plan C — full inventory + incoming snapshot for one depot. Offline-cached. */
export function useDepotInventory(depotId: string | null) {
  const [initial, setInitial] = useState<DepotInventoryPayload | null>(null);

  useEffect(() => {
    if (!depotId) return;
    let cancelled = false;
    void readCache(depotId).then((p) => {
      if (!cancelled) setInitial(p);
    });
    return () => {
      cancelled = true;
    };
  }, [depotId]);

  return useQuery<DepotInventoryPayload>({
    queryKey: ['deposit-inventory', depotId],
    enabled: !!depotId,
    initialData: initial ?? undefined,
    queryFn: async () => {
      const data = await mobileApiClient.get<DepotInventoryPayload>(
        `/api/v1/deposit-inventory/${depotId}`,
      );
      // Write-through cache so cold-boot offline still shows yesterday's snapshot.
      if (depotId) {
        void writeCache(depotId, data);
      }
      return data;
    },
    // Distance and perimeter state are live facts about a truck 200 m away —
    // stale-by-a-minute is stale enough to be wrong. Poll, and keep polling in
    // the foreground.
    staleTime: DEPOT_POLL_MS,
    refetchInterval: DEPOT_POLL_MS,
    /*
     * Load-bearing. React Query's default 'online' mode PAUSES a query when the
     * device is offline rather than failing it, so `isLoading` never resolves and
     * the SQLite snapshot below it never gets a chance to render — the operator
     * sees a spinner forever exactly when the cache is all he has. Same rule as
     * useMyTasks / useCachedParcels.
     */
    networkMode: 'always',
    retry: 1,
  });
}

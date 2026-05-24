import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { mobileLogger } from '@/lib/logger';

export interface DepotInventoryPayload {
  depot: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    coordsGeoJson: string | null;
  };
  inventory: {
    totalBales: number;
    totalNetWeightKg: number;
    lastUpdate: string | null;
  };
  incoming: Array<{
    tripId: string;
    tripNumber: string;
    status: string;
    baleCount: number;
    iterationIndex: number | null;
    truckPlate: string | null;
    truckCode: string | null;
    driverName: string | null;
  }>;
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
    staleTime: 60_000,
  });
}

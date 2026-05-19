/**
 * FM-11: Hook that aggregates today's records for the current operator from
 * all four local repos (bale_productions, fuel_logs, consumable_logs,
 * bale_loads) and annotates each entry with its sync status from the
 * sync_queue table.
 *
 * Works completely offline — reads only from SQLite.
 */

import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { getDatabase } from '@/lib/storage';
import { BaleProductionsRepo } from '@/db/bale-productions-repo';
import { FuelLogsRepo } from '@/db/fuel-logs-repo';
import { ConsumableLogsRepo } from '@/db/consumable-logs-repo';
import { BaleLoadsRepo } from '@/db/bale-loads-repo';
import { todayInRomania, addDays, startOfDayRomaniaISO } from '@/lib/date';

// ---- Types ------------------------------------------------------------------

export type ActivityKind = 'production' | 'fuel' | 'consumable' | 'load';

export type SyncStatus = 'synced' | 'pending' | 'failed';

export interface ActivityEntry {
  /** Unique row UUID from the source table. */
  id: string;
  kind: ActivityKind;
  /** Human-readable type label in Romanian. */
  label: string;
  /** Short description of the amount recorded. */
  detail: string;
  /** ISO timestamp to use for sorting (created_at, logged_at, or loaded_at). */
  timestamp: string;
  syncStatus: SyncStatus;
}

// ---- Constants --------------------------------------------------------------

const KIND_LABELS: Record<ActivityKind, string> = {
  production: 'Productie baloti',
  fuel: 'Combustibil',
  consumable: 'Consumabil',
  load: 'Incarcare baloti',
};

// ---- Helpers ----------------------------------------------------------------

function formatFuelType(ft: string): string {
  switch (ft) {
    case 'diesel':
      return 'Motorina';
    case 'petrol':
      return 'Benzina';
    default:
      return ft;
  }
}

// ---- Main hook --------------------------------------------------------------

export interface TodayActivityResult {
  entries: ActivityEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTodayActivity(operatorId: string | null | undefined): TodayActivityResult {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!operatorId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    try {
      const db = await getDatabase();

      // Build UTC window for today in Romania timezone
      const today = todayInRomania();
      const dayStart = startOfDayRomaniaISO(today);
      const dayEnd = startOfDayRomaniaISO(addDays(today, 1));

      const prodRepo = new BaleProductionsRepo(db);
      const fuelRepo = new FuelLogsRepo(db);
      const consumableRepo = new ConsumableLogsRepo(db);
      const loadRepo = new BaleLoadsRepo(db);

      // Fetch all four sources in parallel, filtering locally to today
      const [allProductions, allFuel, allConsumables, allLoads] = await Promise.all([
        prodRepo.listByOperator(operatorId),
        fuelRepo.listByOperator(operatorId),
        consumableRepo.listByOperator(operatorId),
        // BaleLoadsRepo has listByOperatorSince — use that with today's start
        loadRepo.listByOperatorSince(operatorId, dayStart),
      ]);

      // Filter productions to today (production_date is YYYY-MM-DD)
      const todayProductions = allProductions.filter((p) => p.production_date === today);

      // Filter fuel logs to today's UTC window
      const todayFuel = allFuel.filter((f) => f.logged_at >= dayStart && f.logged_at < dayEnd);

      // Filter consumable logs to today's UTC window
      const todayConsumables = allConsumables.filter(
        (c) => c.logged_at >= dayStart && c.logged_at < dayEnd,
      );

      // Collect all IDs to query their sync status in one go
      const allIds: string[] = [
        ...todayProductions.map((p) => p.id),
        ...todayFuel.map((f) => f.id),
        ...todayConsumables.map((c) => c.id),
        ...allLoads.map((l) => l.id),
      ];

      // Build a status map: entityId -> 'pending' | 'failed' | 'synced'
      // Query sync_queue for any non-completed entry for these IDs
      const syncStatusMap: Map<string, SyncStatus> = new Map();
      if (allIds.length > 0) {
        const placeholders = allIds.map(() => '?').join(', ');
        const rows = await db.getAllAsync<{ entity_id: string; status: string }>(
          `SELECT entity_id, status FROM sync_queue
           WHERE entity_id IN (${placeholders})
             AND status NOT IN ('completed')
           ORDER BY updated_at DESC`,
          allIds,
        );
        for (const row of rows) {
          // If there are multiple entries for the same ID, use the worst status
          const current = syncStatusMap.get(row.entity_id);
          if (!current) {
            syncStatusMap.set(row.entity_id, row.status === 'failed' ? 'failed' : 'pending');
          } else if (current === 'pending' && row.status === 'failed') {
            syncStatusMap.set(row.entity_id, 'failed');
          }
        }
      }

      const getSyncStatus = (id: string): SyncStatus => syncStatusMap.get(id) ?? 'synced';

      // Build unified entries list
      const result: ActivityEntry[] = [];

      for (const p of todayProductions) {
        result.push({
          id: p.id,
          kind: 'production',
          label: KIND_LABELS.production,
          detail: `${p.bale_count} baloti`,
          timestamp: p.created_at,
          syncStatus: getSyncStatus(p.id),
        });
      }

      for (const f of todayFuel) {
        result.push({
          id: f.id,
          kind: 'fuel',
          label: KIND_LABELS.fuel,
          detail: `${f.quantity_liters} L ${formatFuelType(f.fuel_type)}`,
          timestamp: f.logged_at,
          syncStatus: getSyncStatus(f.id),
        });
      }

      for (const c of todayConsumables) {
        result.push({
          id: c.id,
          kind: 'consumable',
          label: KIND_LABELS.consumable,
          detail: `${c.quantity} ${c.unit} ${c.consumable_type}`,
          timestamp: c.logged_at,
          syncStatus: getSyncStatus(c.id),
        });
      }

      for (const l of allLoads) {
        result.push({
          id: l.id,
          kind: 'load',
          label: KIND_LABELS.load,
          detail: `${l.bale_count} baloti`,
          timestamp: l.loaded_at ?? l.created_at,
          syncStatus: getSyncStatus(l.id),
        });
      }

      // Sort descending by timestamp
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      setEntries(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu s-au putut incarca activitatile.');
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Refresh on app foreground resume
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  return { entries, loading, error, refresh: load };
}

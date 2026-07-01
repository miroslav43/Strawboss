import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { mobileLogger } from '@/lib/logger';

/**
 * Resolve the machine (truck) a driver's fuel log should be attributed to.
 *
 * A driver normally carries a permanent `assigned_machine_id` (their truck),
 * surfaced as `assignedMachineId` on the auth store. When that is missing — the
 * driver hops trucks per trip, or the assignment was wiped — fall back to the
 * truck of their active (non-terminal) trip.
 *
 * This matters because `fuel_logs.machine_id` is NOT NULL server-side: a fuel
 * log saved without a machine is accepted into local SQLite but rejected on
 * push (Postgres 23502) and then retries forever, so the fueling never reaches
 * the server. Resolving a truck here keeps offline fuel logging working even
 * when the permanent assignment is absent.
 *
 * Returns `null` only when there is neither a permanent machine nor an active
 * trip with a truck — in which case the fuel flow blocks the save with a clear
 * message rather than queueing a doomed row.
 */
export function useDriverTruckId(): string | null {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const [tripTruckId, setTripTruckId] = useState<string | null>(null);

  useEffect(() => {
    // The permanent assignment wins; skip the DB read entirely when present.
    if (assignedMachineId) {
      setTripTruckId(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const db = await getDatabase();
        const active = await new TripsRepo(db).listActive();
        const withTruck = active.filter((t) => t.truck_id);
        // Prefer the trip the driver is actively running; otherwise any active
        // trip that carries a truck.
        const preferred =
          withTruck.find((t) => t.status === 'in_transit' || t.status === 'loaded') ?? withTruck[0];
        if (!cancelled) setTripTruckId(preferred?.truck_id ?? null);
      } catch (err) {
        mobileLogger.warn('useDriverTruckId: active trip load failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [assignedMachineId]);

  return assignedMachineId ?? tripTruckId;
}

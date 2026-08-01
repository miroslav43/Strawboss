/**
 * useMyAssignedParcelIds — the set of parcel ids assigned to the logged-in
 * operator "today", used to color those fields purple on the map.
 *
 * Deliberately SQLite-only — no network arm. The sync pull already force-
 * includes today's own `task_assignments` rows (sync.service.ts) and every
 * non-terminal `trips` row, so the local cache is already complete for
 * exactly what this needs. Adding a REST arm would mean an online phone
 * shows purple fields a moment before an offline one does (until its next
 * sync) — a second code path answering the same question differently, for
 * no benefit. One source, in sync with the fleet's traffic diet: this reuses
 * data the app already has cached and issues zero new requests.
 *
 * Three owners, unioned:
 *  - Baler/loader: `task_assignments` rows for today whose `parcel_id` is set
 *    and which belong to this operator (via `isMyAssignment` — the same
 *    predicate `useMyTasks`'s offline fallback uses, so the two "my fields
 *    today" answers can't drift apart).
 *  - Driver, own trip: truck `task_assignments` carry no `parcel_id` at all —
 *    the driver's field is `trips.source_parcel_id`, inherited from the parent
 *    loader task when the trip was created (`materializeTripFromTask` in
 *    trips.service.ts). So it comes from their own live trips instead.
 *  - Driver, the loader's whole day: a driver works a *loader*, not a single
 *    field — the loader moves down its list of parcels for the day and the
 *    truck follows it. `trips.loader_id` names that machine, so every one of
 *    TODAY's assignments for it belongs on the map, not just the one field
 *    the current trip happens to point at. Free: it re-reads the
 *    `assignments` list already fetched above, so no extra query and still
 *    no network.
 *
 * That last arm works offline because pull narrows only the *force-include*
 * arm of `task_assignments` to the caller's own slice; the
 * `sync_version > cursor` arm stays org-wide and the table carries no
 * `ownerFilter` at all (sync.service.ts) — so the loader's rows are already
 * on the driver's phone.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { addDays, todayInRomania } from '@/lib/date';
import { getDatabase } from '@/lib/storage';
import { TaskAssignmentsRepo } from '@/db/task-assignments-repo';
import { TripsRepo } from '@/db/trips-repo';
import type { LocalTrip } from '@/db/trips-repo';
import { isMyAssignment } from '@/lib/my-assignments';

/**
 * Whether a non-terminal trip still represents work in play.
 *
 * `TripsRepo.listActive()` filters on status alone, and an abandoned
 * `planned` trip is immortal on the phone: the pull force-includes every
 * non-terminal trip precisely so a version-skewed row can never be stranded
 * behind the cursor (sync.service.ts), so a plan the dispatcher walked away
 * from weeks ago keeps arriving forever — and would keep its field purple
 * forever with it.
 *
 * A trip that has left `planned` is demonstrably in motion: keep it however
 * long it takes. A trip still sitting in `planned` has to have been touched
 * today or yesterday. Yesterday and not just today, so planning the evening
 * before still lights up in the morning — and because `updated_at` is a UTC
 * timestamp while the day boundary here is Romania's, that same day of slack
 * absorbs the offset instead of needing a second conversion.
 */
function isLivePlan(trip: LocalTrip, earliestPlanDay: string): boolean {
  if (trip.status !== 'planned') return true;
  const touchedDay = (trip.updated_at || trip.created_at || '').slice(0, 10);
  return touchedDay >= earliestPlanDay;
}

async function readAssignedParcelIds(
  userId: string,
  machineId: string | null,
): Promise<Set<string>> {
  const db = await getDatabase();
  const ids = new Set<string>();
  const today = todayInRomania();

  const assignments = await new TaskAssignmentsRepo(db).listByDate(today);
  for (const a of assignments) {
    if (a.parcel_id && isMyAssignment(a, { userId, machineId })) {
      ids.add(a.parcel_id);
    }
  }

  // Driver: the source field of their own live trips, plus every field the
  // loader those trips ride with is working today.
  const earliestPlanDay = addDays(today, -1);
  const loaderMachineIds = new Set<string>();
  const trips = await new TripsRepo(db).listActive();
  for (const t of trips) {
    if (t.driver_id !== userId && t.loader_operator_id !== userId) continue;
    if (!isLivePlan(t, earliestPlanDay)) continue;
    if (t.source_parcel_id) ids.add(t.source_parcel_id);
    if (t.loader_id) loaderMachineIds.add(t.loader_id);
  }

  if (loaderMachineIds.size > 0) {
    for (const a of assignments) {
      if (a.parcel_id && a.machine_id && loaderMachineIds.has(a.machine_id)) {
        ids.add(a.parcel_id);
      }
    }
  }

  return ids;
}

export interface UseMyAssignedParcelIdsResult {
  /** Parcel ids assigned to the logged-in operator today. Empty set until resolved. */
  assignedParcelIds: Set<string>;
}

export function useMyAssignedParcelIds(): UseMyAssignedParcelIdsResult {
  const userId = useAuthStore((s) => s.userId);
  const machineId = useAuthStore((s) => s.assignedMachineId);
  const today = todayInRomania();

  const query = useQuery({
    queryKey: ['my-assigned-parcel-ids', today, userId, machineId],
    queryFn: () => readAssignedParcelIds(userId as string, machineId),
    enabled: !!userId,
    staleTime: 30_000,
    // Touches no network — never pause this offline.
    networkMode: 'always',
  });

  return { assignedParcelIds: query.data ?? EMPTY_SET };
}

// Stable empty-set identity so callers memoizing on `assignedParcelIds` don't
// see a spurious identity change while the first query is still resolving.
const EMPTY_SET: Set<string> = new Set();

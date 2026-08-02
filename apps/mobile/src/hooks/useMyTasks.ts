import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { todayInRomania } from '@/lib/date';
import { getDatabase } from '@/lib/storage';
import { DeliveryDestinationsRepo } from '@/db/delivery-destinations-repo';
import { TaskAssignmentsRepo } from '@/db/task-assignments-repo';
import { ParcelsRepo } from '@/db/parcels-repo';
import { isMyAssignment } from '@/lib/my-assignments';
import { mobileLogger } from '@/lib/logger';

/** Minimal GeoJSON shapes returned by the backend (ST_AsGeoJSON). */
interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number]; // [lon, lat]
}

export interface MyTask {
  id: string;
  assignmentDate: string;
  machineId: string;
  parcelId: string | null;
  assignedUserId: string | null;
  priority: string;
  sequenceOrder: number;
  status: string;
  parentAssignmentId: string | null;
  destinationId: string | null;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  notes: string | null;
  machineCode: string;
  machineType: string;
  registrationPlate: string | null;
  parcelName: string | null;
  parcelCode: string | null;
  assignedUserName: string | null;
  destinationName: string | null;
  destinationCode: string | null;
  /** Depot geometry (GeoJSON) for computing in-depot presence — null when absent. */
  destinationBoundary: object | null;
  destinationCoords: GeoJsonPoint | null;
  destinationConfirmRadiusM: number | null;
}

/**
 * Cache the geometry of every task destination (depot) into local SQLite so
 * `useCurrentLoaderParcel` (in-depot presence) and the driver's destination
 * proximity / geofence-wake can read it offline. Without this, the
 * `delivery_destinations` table is never populated on a non-geofence-maker
 * device and depot presence is stuck on "unknown". Best-effort; never throws.
 */
async function cacheTaskDestinations(tasks: MyTask[]): Promise<void> {
  const withGeometry = tasks.filter(
    (t) => t.destinationId && (t.destinationBoundary || t.destinationCoords),
  );
  if (!withGeometry.length) return;
  try {
    const db = await getDatabase();
    const repo = new DeliveryDestinationsRepo(db);
    const now = new Date().toISOString();
    for (const t of withGeometry) {
      const coords = t.destinationCoords
        ? // GeoJSON Point is [lon, lat]; computeDepotPresence expects { lat, lon }.
          JSON.stringify({
            lat: t.destinationCoords.coordinates[1],
            lon: t.destinationCoords.coordinates[0],
          })
        : null;
      await repo.upsert({
        id: t.destinationId as string,
        code: t.destinationCode ?? '',
        name: t.destinationName ?? '',
        address: null,
        boundary: t.destinationBoundary ? JSON.stringify(t.destinationBoundary) : null,
        coords_json: coords,
        confirm_radius_m: t.destinationConfirmRadiusM ?? null,
        is_default: 0,
        cached_at: now,
      });
    }
  } catch (err) {
    mobileLogger.flow('useMyTasks: cache task destinations failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Drop placeholder / admin-empty rows with no field or destination to show or open on the map. */
function taskHasRenderableLocation(t: MyTask): boolean {
  const parcelOk =
    (t.parcelId != null && t.parcelId !== '') ||
    (t.parcelName != null && String(t.parcelName).trim() !== '') ||
    (t.parcelCode != null && String(t.parcelCode).trim() !== '');
  const destOk =
    (t.destinationId != null && t.destinationId !== '') ||
    (t.destinationName != null && String(t.destinationName).trim() !== '') ||
    (t.destinationCode != null && String(t.destinationCode).trim() !== '');
  return parcelOk || destOk;
}

/**
 * Offline fallback for `useMyTasks` — rebuilds the same `MyTask[]` shape from
 * the already-synced local `task_assignments` + `parcels` tables, so a phone
 * with no signal still has a resolvable "my field today" instead of an empty
 * list that bounces the operator off the load/production screens.
 *
 * Fields the local mirror cannot carry (`PULL_COLUMNS.task_assignments` in
 * `sync.service.ts` omits them, and the local `task_assignments` schema has no
 * columns for them either) and what that costs downstream:
 *  - `status` — synthesized as `'available'`. `useCurrentLoaderParcel` no
 *    longer reads `status` at all, precisely because this field cannot survive
 *    the pull: any resolution tier keyed on `in_progress` behaved differently
 *    offline than online. The only remaining cost is the driver's "first
 *    not-done task" card, which may show a task finished earlier — it corrects
 *    itself at the next sync. Do not reintroduce a `status` dependency here
 *    without first adding the column to `PULL_COLUMNS.task_assignments`.
 *  - `destinationId` (+ depot name/code/geometry) — always `null`. A
 *    depot-sourced task cannot resolve offline. This is not a new gap: depot
 *    loads are already hard-blocked offline at the load screen.
 *  - `machineCode`/`machineType`/`assignedUserName` — cosmetic list fields,
 *    left blank; `taskHasRenderableLocation` only needs the parcel/destination
 *    identity, not these.
 */
async function readTasksFromSqlite(userId: string, machineId: string | null): Promise<MyTask[]> {
  const db = await getDatabase();
  const today = todayInRomania();
  const assignments = (await new TaskAssignmentsRepo(db).listByDate(today)).filter(
    (a) => a.parcel_id != null && isMyAssignment(a, { userId, machineId }),
  );
  if (!assignments.length) return [];

  const parcelIds = [...new Set(assignments.map((a) => a.parcel_id as string))];
  const parcelById = new Map(
    (await new ParcelsRepo(db).listByIds(parcelIds)).map((p) => [p.id, p] as const),
  );

  const tasks: MyTask[] = assignments.map((a) => {
    const p = a.parcel_id ? parcelById.get(a.parcel_id) : undefined;
    return {
      id: a.id,
      assignmentDate: a.assignment_date,
      machineId: a.machine_id ?? '',
      parcelId: a.parcel_id,
      assignedUserId: a.assigned_user_id,
      priority: a.priority,
      sequenceOrder: a.sequence_order,
      status: 'available',
      parentAssignmentId: null,
      destinationId: null,
      estimatedStart: a.estimated_start,
      estimatedEnd: a.estimated_end,
      actualStart: a.actual_start,
      actualEnd: a.actual_end,
      notes: a.notes,
      machineCode: '',
      machineType: '',
      registrationPlate: null,
      parcelName: p?.name ?? null,
      parcelCode: p?.code ?? null,
      assignedUserName: null,
      destinationName: null,
      destinationCode: null,
      destinationBoundary: null,
      destinationCoords: null,
      destinationConfirmRadiusM: null,
    };
  });

  return tasks.sort((a, b) => a.sequenceOrder - b.sequenceOrder).filter(taskHasRenderableLocation);
}

/**
 * M40: Fetches today's task assignments for the current user via the
 * server-side filtered endpoint `GET /api/v1/task-assignments/my-tasks?date=YYYY-MM-DD`,
 * with an offline SQLite fallback so a phone with no signal (or a signal with
 * no throughput) still resolves a field instead of hanging or bouncing the
 * operator off the screen.
 *
 * Two paired queries, server wins when it answers:
 *  - `local` — instant, offline, `networkMode: 'always'` (touches no
 *    network; the default `'online'` mode would pause it whenever the app is
 *    offline, starving the exact moment it is needed).
 *  - `remote` — the authoritative source. Also `networkMode: 'always'`: this
 *    is the load-bearing change. React Query's default mode PAUSES a query
 *    while offline instead of failing it, so `isLoading` would stay `true`
 *    forever and `local` would never get a chance to win. With `'always'`
 *    (plus the fetch timeout wired into `mobileApiClient`), a dead connection
 *    now fails within ~15s instead of hanging indefinitely.
 *
 * Return shape is otherwise identical to the previous implementation so
 * existing consumers of `useMyTasks` continue to work without changes; the
 * new `fromCache` flag is additive.
 */
export function useMyTasks() {
  const userId = useAuthStore((s) => s.userId);
  const machineId = useAuthStore((s) => s.assignedMachineId);
  const today = todayInRomania();

  const local = useQuery({
    queryKey: ['my-tasks-local', today, userId, machineId],
    queryFn: () => readTasksFromSqlite(userId as string, machineId),
    enabled: !!userId,
    staleTime: 30_000,
    networkMode: 'always',
  });

  const remote = useQuery({
    queryKey: ['my-tasks', today, userId],
    queryFn: async () => {
      const tasks = await mobileApiClient.get<MyTask[]>(
        `/api/v1/task-assignments/my-tasks?date=${today}`,
      );

      // Cache depot geometry before returning so presence/geofence readers can
      // pick it up from SQLite (the delivery_destinations table has no sync path).
      await cacheTaskDestinations(tasks);

      const sorted = [...tasks].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      return sorted.filter(taskHasRenderableLocation);
    },
    enabled: !!userId,
    refetchInterval: 60_000,
    networkMode: 'always',
    retry: 1,
  });

  return {
    tasks: remote.data ?? local.data ?? [],
    // Not "loading" once EITHER source has answered — local resolves in a
    // few ms, so this stops blocking on the network almost immediately.
    isLoading: remote.isLoading && local.isLoading,
    error: remote.error,
    refetch: remote.refetch,
    /** True when the list shown came from the offline cache, not a fresh server response. */
    fromCache: !remote.isSuccess,
  };
}

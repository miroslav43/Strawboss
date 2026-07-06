import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { todayInRomania } from '@/lib/date';
import { getDatabase } from '@/lib/storage';
import { DeliveryDestinationsRepo } from '@/db/delivery-destinations-repo';
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
 * M40: Fetches today's task assignments for the current user via the
 * server-side filtered endpoint `GET /api/v1/task-assignments/my-tasks?date=YYYY-MM-DD`.
 *
 * This replaces the previous implementation that fetched the full daily plan
 * and filtered client-side by `assignedUserId`.  The new endpoint returns only
 * the assignments belonging to the authenticated user, reducing payload size.
 *
 * Return shape is identical to the previous implementation so all existing
 * consumers of `useMyTasks` continue to work without changes.
 */
export function useMyTasks() {
  const userId = useAuthStore((s) => s.userId);
  const today = todayInRomania();

  const query = useQuery({
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
    refetchInterval: 30_000,
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

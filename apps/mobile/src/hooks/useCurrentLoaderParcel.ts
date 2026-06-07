import { useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { useAuthStore } from '@/stores/auth-store';
import { useActiveParcels, findParcelAtLocation, type ActiveParcel } from './useActiveParcels';
import { useMyTasks, type MyTask } from './useMyTasks';
import { distanceToBoundaryMeters } from '@/lib/point-in-geojson';
import { mobileLogger } from '@/lib/logger';

export type CurrentParcelStatus =
  | 'loading'
  | 'resolved'
  | 'needs_start'
  | 'multiple_active'
  | 'unavailable';

/** Live "am I physically on the field" state. */
export type ParcelPresence = 'inside' | 'outside' | 'unknown';

export interface CurrentLoaderParcel {
  status: CurrentParcelStatus;
  /** Parcel id when `status === 'resolved'`. */
  parcelId: string | null;
  parcelName: string | null;
  /** T9.3 — code identifier; used as the display name when name is null. */
  parcelCode: string | null;
  /** How the parcel was resolved. */
  source: 'in_progress_task' | 'gps' | null;
  /** Whether the operator's GPS is strictly inside the resolved field boundary. */
  presence: ParcelPresence;
  /** Metres to the field boundary when `presence === 'outside'`. */
  distanceM: number | null;
  /**
   * When `status === 'needs_start'`: available tasks to pick from.
   * When `status === 'multiple_active'`: in_progress tasks GPS couldn't disambiguate.
   */
  candidates: MyTask[];
  /** Re-run resolution (resets GPS and task state). */
  refresh: () => void;
}

/**
 * Role-agnostic alias: the resolution logic depends only on the operator's
 * assigned machine + tasks + GPS, so the baler home reuses the same shape via
 * the shared ActiveFieldCard. Prefer this name in role-neutral code.
 */
export type CurrentFieldParcel = CurrentLoaderParcel;

/** Distance/inside check of a GPS fix against a resolved parcel's boundary. */
function computePresence(
  parcelId: string | null,
  gps: { lat: number; lon: number } | null,
  gpsReady: boolean,
  parcels: ActiveParcel[] | undefined,
): { presence: ParcelPresence; distanceM: number | null } {
  if (!gpsReady || !gps || !parcelId || !parcels) return { presence: 'unknown', distanceM: null };
  const p = parcels.find((x) => x.id === parcelId);
  if (!p || p.boundary == null) return { presence: 'unknown', distanceM: null };
  // Strict containment — no tolerance buffer. distanceToBoundaryMeters returns
  // exactly 0 only when the GPS point is truly inside the polygon; any other
  // value means "outside" and is the real distance left to reach the field.
  const d = distanceToBoundaryMeters(gps.lon, gps.lat, p.boundary);
  if (d === 0) return { presence: 'inside', distanceM: 0 };
  return { presence: 'outside', distanceM: Math.round(d) };
}

const GPS_TIMEOUT_MS = 15_000;
const GPS_RETRY_DELAY_MS = 5_000;
const GPS_MAX_RETRIES = 1;

/**
 * Resolve the loader's current parcel ("teren activ").
 *
 * Strict GPS-only when the loader has 2+ parcels assigned today: the operator
 * is never asked to pick manually. The only auto-resolve without GPS is the
 * trivial case of a single parcel assigned for the whole day.
 *
 * Resolution order:
 *  1. Loader has exactly **one** task assigned today (any status) →
 *     resolve to that parcel without consulting GPS (single-parcel shortcut).
 *  2. GPS inside a parcel boundary:
 *     - 2+ in_progress: restrict GPS check to those parcel IDs.
 *     - 0 in_progress: check all assigned task parcels.
 *     - 1 in_progress + other availables: same GPS check across all (we no
 *       longer trust the in_progress flag alone when the loader has multiple
 *       parcels to choose from).
 *  3. 2+ in_progress but GPS could not pick one → `multiple_active`
 *     (banner shows a "Reîncearcă GPS" button — no manual list).
 *  4. 0 in_progress → `needs_start` with the assigned-but-not-yet-started
 *     tasks as informational context, or `unavailable` when nothing's
 *     assigned. The screen still forbids manual selection.
 *
 * GPS is attempted with a 15s timeout and one automatic retry before giving up.
 */
export function useCurrentLoaderParcel(): CurrentLoaderParcel {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const { tasks, isLoading: tasksLoading } = useMyTasks();
  const { data: activeParcels, isLoading: parcelsLoading } = useActiveParcels();

  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    'idle' | 'loading' | 'retrying' | 'unavailable' | 'ready'
  >('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;

    const attemptGps = async () => {
      try {
        setGpsStatus(retryCount === 0 ? 'loading' : 'retrying');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setGpsStatus('unavailable');
          return;
        }
        const loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('GPS timeout')), GPS_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;
        setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude });
        setGpsStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (retryCount < GPS_MAX_RETRIES) {
          retryCount++;
          mobileLogger.flow('useCurrentLoaderParcel: GPS timeout, scheduling retry', {
            attempt: retryCount,
          });
          retryTimerRef.current = setTimeout(() => {
            if (!cancelled) void attemptGps();
          }, GPS_RETRY_DELAY_MS);
        } else {
          setGpsStatus('unavailable');
          mobileLogger.flow('useCurrentLoaderParcel: GPS unavailable after retry', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    void attemptGps();

    // Live presence: silently re-sample GPS every 30 s so the inside/outside
    // badge follows the operator without flickering the card back to "loading".
    const presenceInterval = setInterval(() => {
      void (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== 'granted') return;
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude });
        } catch {
          // Keep the last known fix; presence stays on the previous value.
        }
      })();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(presenceInterval);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [refreshKey]);

  const refresh = () => {
    setGps(null);
    setGpsStatus('idle');
    setRefreshKey((k) => k + 1);
  };

  if (tasksLoading || parcelsLoading) {
    return {
      status: 'loading',
      parcelId: null,
      parcelName: null,
      parcelCode: null,
      source: null,
      presence: 'unknown',
      distanceM: null,
      candidates: [],
      refresh,
    };
  }

  const myMachineTasks = tasks.filter(
    (t) => assignedMachineId != null && t.machineId === assignedMachineId,
  );
  const inProgress = myMachineTasks.filter((t) => t.status === 'in_progress' && !!t.parcelId);
  // Distinct parcel ids across all today's tasks (any status) — used to
  // detect the "single parcel assigned" shortcut.
  const distinctTaskParcelIds = new Set(
    myMachineTasks.map((t) => t.parcelId).filter(Boolean) as string[],
  );

  // Tier 1: exactly one parcel assigned for the whole day → resolve without
  // GPS. The trivial case where there's nothing to pick between.
  if (distinctTaskParcelIds.size === 1) {
    const t = myMachineTasks.find((mt) => !!mt.parcelId)!;
    const { presence, distanceM } = computePresence(
      t.parcelId,
      gps,
      gpsStatus === 'ready',
      activeParcels,
    );
    return {
      status: 'resolved',
      parcelId: t.parcelId,
      // Unnamed terrains fall back to the code so the card is never blank.
      parcelName: t.parcelName ?? t.parcelCode,
      parcelCode: t.parcelCode,
      source: 'in_progress_task',
      presence,
      distanceM,
      candidates: [],
      refresh,
    };
  }

  // Tier 2: GPS inside a parcel boundary.
  // For 2+ in_progress: restrict to those parcel IDs so GPS can disambiguate.
  // For 0 in_progress: check all task-assigned parcels.
  if (gpsStatus === 'ready' && gps && activeParcels?.length) {
    const restrictIds: Set<string> =
      inProgress.length > 1
        ? new Set(inProgress.map((t) => t.parcelId).filter(Boolean) as string[])
        : new Set(myMachineTasks.map((t) => t.parcelId).filter(Boolean) as string[]);
    const gpsPool: ActiveParcel[] = restrictIds.size
      ? activeParcels.filter((p) => restrictIds.has(p.id))
      : activeParcels;
    const hit = findParcelAtLocation(gps.lon, gps.lat, gpsPool);
    if (hit) {
      // GPS resolves WHICH field (tolerance helps disambiguate between parcels),
      // but presence is strict: "inside" only when the point is truly within the
      // boundary, otherwise show the real distance left to reach it.
      const { presence, distanceM } = computePresence(hit.id, gps, true, activeParcels);
      return {
        status: 'resolved',
        parcelId: hit.id,
        parcelName: hit.name,
        parcelCode: hit.code,
        source: 'gps',
        presence,
        distanceM,
        candidates: [],
        refresh,
      };
    }
  }

  // Tier 3: 2+ in_progress but GPS couldn't pick one → operator must confirm.
  if (inProgress.length > 1) {
    return {
      status: 'multiple_active',
      parcelId: null,
      parcelName: null,
      parcelCode: null,
      source: null,
      presence: 'unknown',
      distanceM: null,
      candidates: inProgress,
      refresh,
    };
  }

  // Tier 4: GPS didn't match any assigned parcel. Surface ALL tasks (any
  // status) as informational candidates so the operator knows where to walk;
  // the screen renders them read-only with a "Reîncearcă GPS" button.
  const assignedAny = myMachineTasks.filter((t) => !!t.parcelId);
  return {
    status: assignedAny.length ? 'needs_start' : 'unavailable',
    parcelId: null,
    parcelName: null,
    parcelCode: null,
    source: null,
    presence: 'unknown',
    distanceM: null,
    candidates: assignedAny,
    refresh,
  };
}

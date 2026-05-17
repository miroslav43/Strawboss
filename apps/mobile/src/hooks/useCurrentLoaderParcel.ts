import { useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { useAuthStore } from '@/stores/auth-store';
import {
  useActiveParcels,
  findParcelAtLocation,
  type ActiveParcel,
} from './useActiveParcels';
import { useMyTasks, type MyTask } from './useMyTasks';
import { mobileLogger } from '@/lib/logger';

export type CurrentParcelStatus =
  | 'loading'
  | 'resolved'
  | 'needs_start'
  | 'multiple_active'
  | 'unavailable';

export interface CurrentLoaderParcel {
  status: CurrentParcelStatus;
  /** Parcel id when `status === 'resolved'`. */
  parcelId: string | null;
  parcelName: string | null;
  /** How the parcel was resolved. */
  source: 'in_progress_task' | 'gps' | null;
  /**
   * When `status === 'needs_start'`: available tasks to pick from.
   * When `status === 'multiple_active'`: in_progress tasks GPS couldn't disambiguate.
   */
  candidates: MyTask[];
  /** Re-run resolution (resets GPS and task state). */
  refresh: () => void;
}

const GPS_TIMEOUT_MS = 15_000;
const GPS_RETRY_DELAY_MS = 5_000;
const GPS_MAX_RETRIES = 1;

/**
 * Resolve the loader's current parcel ("teren activ").
 *
 * Resolution order:
 *  1. Exactly one in_progress task today for the loader's machine → use it.
 *  2. GPS inside a parcel boundary:
 *     - 2+ in_progress: restrict GPS check to those parcel IDs to pick between them.
 *     - 0 in_progress: check all assigned task parcels.
 *  3. 2+ in_progress but GPS failed → `multiple_active` (surface them for manual pick).
 *  4. 0 in_progress → `needs_start` with available task candidates, or `unavailable`.
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
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: GPS_TIMEOUT_MS,
        });
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

    return () => {
      cancelled = true;
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
      source: null,
      candidates: [],
      refresh,
    };
  }

  const myMachineTasks = tasks.filter(
    (t) => assignedMachineId != null && t.machineId === assignedMachineId,
  );
  const inProgress = myMachineTasks.filter(
    (t) => t.status === 'in_progress' && !!t.parcelId,
  );

  // Tier 1: exactly one in_progress task → resolved without GPS.
  if (inProgress.length === 1) {
    const t = inProgress[0];
    return {
      status: 'resolved',
      parcelId: t.parcelId,
      parcelName: t.parcelName,
      source: 'in_progress_task',
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
      return {
        status: 'resolved',
        parcelId: hit.id,
        parcelName: hit.name,
        source: 'gps',
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
      source: null,
      candidates: inProgress,
      refresh,
    };
  }

  // Tier 4: no in_progress → offer available tasks or declare unavailable.
  const available = myMachineTasks.filter(
    (t) => t.status === 'available' && !!t.parcelId,
  );
  return {
    status: available.length ? 'needs_start' : 'unavailable',
    parcelId: null,
    parcelName: null,
    source: null,
    candidates: available,
    refresh,
  };
}

import { useEffect, useState } from 'react';
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
  | 'unavailable';

export interface CurrentLoaderParcel {
  status: CurrentParcelStatus;
  /** Parcel id when `status === 'resolved'`. */
  parcelId: string | null;
  parcelName: string | null;
  /** How the parcel was resolved. */
  source: 'in_progress_task' | 'gps' | null;
  /** When `status === 'needs_start'`, the loader's available tasks today. */
  candidates: MyTask[];
  /** Re-run resolution. */
  refresh: () => void;
}

const GPS_TIMEOUT_MS = 5000;

/**
 * Resolve the loader's current parcel ("teren activ") without ever asking
 * the operator to pick from a list. Resolution order:
 *
 *  1. Exactly one in_progress task today for the loader's machine → use it.
 *  2. Otherwise GPS-inside-parcel: pick the smallest assigned parcel whose
 *     boundary contains the loader's current GPS position.
 *  3. Otherwise return `needs_start` with the available tasks for prompting.
 *
 * The hook never prompts; UI decides how to render `needs_start`.
 */
export function useCurrentLoaderParcel(): CurrentLoaderParcel {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const { tasks, isLoading: tasksLoading } = useMyTasks();
  const { data: activeParcels, isLoading: parcelsLoading } = useActiveParcels();

  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'unavailable' | 'ready'>('idle');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
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
        if (!cancelled) {
          setGpsStatus('unavailable');
          mobileLogger.flow('useCurrentLoaderParcel: GPS unavailable', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

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

  // 1) Exactly one in_progress task on the loader's machine with a parcel.
  const myMachineTasks = tasks.filter(
    (t) => assignedMachineId != null && t.machineId === assignedMachineId,
  );
  const inProgress = myMachineTasks.filter(
    (t) => t.status === 'in_progress' && !!t.parcelId,
  );
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

  // 2) GPS-inside-parcel — restrict to parcels referenced by the loader's tasks.
  if (gpsStatus === 'ready' && gps && activeParcels?.length) {
    const assignedParcelIds = new Set(
      myMachineTasks.map((t) => t.parcelId).filter(Boolean) as string[],
    );
    const candidates: ActiveParcel[] = assignedParcelIds.size
      ? activeParcels.filter((p) => assignedParcelIds.has(p.id))
      : activeParcels;
    const hit = findParcelAtLocation(gps.lon, gps.lat, candidates);
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

  // 3) Need to start a task — surface available candidates for the prompt.
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

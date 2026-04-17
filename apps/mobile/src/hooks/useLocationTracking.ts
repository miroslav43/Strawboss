import { useState, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import {
  isBackgroundLocationTrackingActive,
  readLastLocationSuccessIso,
} from '@/lib/location';

interface UseLocationTrackingResult {
  /** True when Android background location updates (FGS) are active. */
  isTracking: boolean;
  error: string | null;
  /** Last successful server ping (local clock), from disk. */
  lastReportedAt: string | null;
  refresh: () => Promise<void>;
}

/**
 * Read-only status for GPS tracking. On Android, tracking is started automatically
 * from `AuthGate` when the user has an assigned machine; there is no in-app toggle here.
 */
export function useLocationTracking(): UseLocationTrackingResult {
  const [isTracking, setIsTracking] = useState(false);
  const [lastReportedAt, setLastReportedAt] = useState<string | null>(null);
  const [error] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const active = await isBackgroundLocationTrackingActive();
    setIsTracking(active);
    const iso = await readLastLocationSuccessIso();
    setLastReportedAt(
      iso ? new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
    );
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);

  return { isTracking, error, lastReportedAt, refresh };
}

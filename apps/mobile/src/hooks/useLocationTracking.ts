import { useState, useRef, useCallback } from 'react';
import {
  requestLocationPermission,
  startLocationWatcher,
  stopLocationWatcher,
} from '@/lib/location';
import type { LocationSubscription } from '@/lib/location';
import { mobileApiClient } from '@/lib/api-client';

interface UseLocationTrackingResult {
  isTracking: boolean;
  error: string | null;
  lastReportedAt: string | null;
  startTracking: (machineId: string) => Promise<void>;
  stopTracking: () => void;
}

/**
 * Hook that manages continuous GPS tracking for a given machine.
 * Each position update is immediately POSTed to POST /api/v1/location/report.
 */
export function useLocationTracking(): UseLocationTrackingResult {
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastReportedAt, setLastReportedAt] = useState<string | null>(null);
  const subscriptionRef = useRef<LocationSubscription | null>(null);

  const startTracking = useCallback(async (machineId: string) => {
    setError(null);

    const granted = await requestLocationPermission();
    if (!granted) {
      setError('Permisiunea de locație a fost refuzată.');
      return;
    }

    const sub = await startLocationWatcher(machineId, async (report) => {
      try {
        await mobileApiClient.post<void>('/api/v1/location/report', report);
        setLastReportedAt(new Date().toLocaleTimeString('ro-RO'));
        setError(null);
      } catch (err) {
        const msg = (err as Error)?.message ?? 'Eroare la trimiterea locației';
        setError(`GPS trimis, dar serverul nu a răspuns: ${msg}`);
        console.warn('[LocationTracking] Failed to report location:', err);
      }
    });

    if (!sub) {
      setError('Nu s-a putut porni urmărirea GPS. Verifică permisiunile.');
      return;
    }

    subscriptionRef.current = sub;
    setIsTracking(true);
  }, []);

  const stopTracking = useCallback(() => {
    if (subscriptionRef.current) {
      stopLocationWatcher(subscriptionRef.current);
      subscriptionRef.current = null;
    }
    setIsTracking(false);
  }, []);

  return { isTracking, error, lastReportedAt, startTracking, stopTracking };
}

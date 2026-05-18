import { useEffect, useState, useCallback, useRef } from 'react';
import { addNotificationListener } from '@/lib/notifications';
import { useAuthStore } from '@/stores/auth-store';
import { getDatabase } from '@/lib/storage';
import { TripsRepo } from '@/db/trips-repo';
import { mobileLogger } from '@/lib/logger';

interface NotificationData {
  type?: string;
  tripId?: string;
}

export interface TripLoadedAlert {
  tripId: string;
  tripNumber: string | null;
  baleCount: number;
  destinationName: string | null;
  destinationId: string | null;
}

export function useTripLoadedAlert() {
  const [activeAlert, setActiveAlert] = useState<TripLoadedAlert | null>(null);
  const userId = useAuthStore((s) => s.userId);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) {
      setActiveAlert(null);
      return;
    }

    // On mount: check for any unacknowledged loaded trip in SQLite.
    void (async () => {
      try {
        const db = await getDatabase();
        const repo = new TripsRepo(db);
        const all = await repo.listActive();
        const loaded = all.find(
          (t) => t.driver_id === userId && t.status === 'loaded' && !t.acknowledged_at,
        );
        if (loaded) {
          setActiveAlert({
            tripId: loaded.id,
            tripNumber: loaded.trip_number,
            baleCount: loaded.bale_count,
            destinationName: loaded.destination_name,
            destinationId: loaded.destination_id,
          });
        }
      } catch (err) {
        mobileLogger.error('useTripLoadedAlert: mount scan failed', { err });
      }
    })();
  }, [userId]);

  useEffect(() => {
    const sub = addNotificationListener((notification) => {
      const data = notification.request.content.data as NotificationData | undefined;
      if (data?.type !== 'trip_loaded' || !data.tripId) return;

      const tripId = data.tripId;
      mobileLogger.flow('TripLoadedAlert: received trip_loaded push', { tripId });

      // Load trip details from SQLite (may not be synced yet — best effort).
      void (async () => {
        try {
          const db = await getDatabase();
          const repo = new TripsRepo(db);
          const trip = await repo.findById(tripId);
          if (trip) {
            setActiveAlert({
              tripId: trip.id,
              tripNumber: trip.trip_number,
              baleCount: trip.bale_count,
              destinationName: trip.destination_name,
              destinationId: trip.destination_id,
            });
          } else {
            // Trip not synced yet — show minimal alert immediately, retry after 3s.
            setActiveAlert({
              tripId,
              tripNumber: null,
              baleCount: 0,
              destinationName: null,
              destinationId: null,
            });
            retryTimerRef.current = setTimeout(() => {
              void (async () => {
                try {
                  const db2 = await getDatabase();
                  const repo2 = new TripsRepo(db2);
                  const synced = await repo2.findById(tripId);
                  if (synced) {
                    setActiveAlert({
                      tripId: synced.id,
                      tripNumber: synced.trip_number,
                      baleCount: synced.bale_count,
                      destinationName: synced.destination_name,
                      destinationId: synced.destination_id,
                    });
                  }
                } catch {
                  // Best-effort — minimal alert remains visible
                }
              })();
            }, 3000);
          }
        } catch (err) {
          mobileLogger.error('useTripLoadedAlert: failed to load trip after push', { tripId, err });
        }
      })();
    });

    return () => {
      sub.remove();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const dismiss = useCallback(async () => {
    if (!activeAlert) return;
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      await repo.acknowledge(activeAlert.tripId);
    } catch {
      // Best-effort
    }
    setActiveAlert(null);
  }, [activeAlert]);

  const onDeparted = useCallback(() => {
    setActiveAlert(null);
  }, []);

  return { activeAlert, dismiss, onDeparted };
}

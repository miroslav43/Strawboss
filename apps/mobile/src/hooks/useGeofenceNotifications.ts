import { useEffect, useRef, useState, useCallback } from 'react';
import { addNotificationResponseListener, addNotificationListener } from '@/lib/notifications';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth-store';

interface NotificationData {
  type?: string;
  assignmentId?: string;
  parcelName?: string;
  tripId?: string;
}

export interface GeofenceAlert {
  type: 'field_entry' | 'exit_confirm' | 'deposit_entry';
  parcelName: string;
  assignmentId: string;
  /** Present for deposit_entry — lets the overlay open the arrival flow. */
  tripId?: string | null;
}

/** Minimum ms between two alerts for the same type+assignmentId key. */
const GEOFENCE_ALERT_DEBOUNCE_MS = 60_000;

/**
 * Listens for geofence-related notifications and exposes an active alert
 * that the UI can display (banner for entry, modal for exit confirmation).
 * Duplicate alerts for the same event within 60 s are suppressed to handle
 * GPS oscillation near boundary edges.
 */
export function useGeofenceNotifications() {
  const [alertQueue, setAlertQueue] = useState<GeofenceAlert[]>([]);
  const activeAlert = alertQueue[0] ?? null;
  const userId = useAuthStore((s) => s.userId);
  /** Tracks the last time each alert key (type:assignmentId) was enqueued. */
  const lastAlertAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!userId) {
      setAlertQueue([]);
    }
  }, [userId]);

  const dismissAlert = useCallback(() => {
    setAlertQueue((q) => q.slice(1));
  }, []);

  const confirmParcelDone = useCallback(async (assignmentId: string, baleCount?: number) => {
    mobileLogger.flow('Geofence: confirm parcel done', {
      assignmentId,
      baleCount,
    });
    try {
      await mobileApiClient.post('/api/v1/notifications/confirm-parcel-done', {
        assignmentId,
        baleCount,
      });
    } catch {
      // Best-effort confirmation
    }
    setAlertQueue((q) => q.slice(1));
  }, []);

  useEffect(() => {
    /**
     * Returns true and records the timestamp if the alert should be shown.
     * Returns false if the same type+assignmentId was already enqueued within
     * GEOFENCE_ALERT_DEBOUNCE_MS — suppresses GPS-oscillation duplicates.
     */
    const shouldEnqueue = (type: string, assignmentId: string): boolean => {
      const key = `${type}:${assignmentId}`;
      const now = Date.now();
      const last = lastAlertAt.current.get(key) ?? 0;
      if (now - last < GEOFENCE_ALERT_DEBOUNCE_MS) {
        mobileLogger.flow('Geofence: suppressed duplicate alert (debounce)', {
          key,
          elapsedMs: now - last,
        });
        return false;
      }
      lastAlertAt.current.set(key, now);
      return true;
    };

    // Handle foreground notifications → show UI alert
    const fgSubscription = addNotificationListener((notification) => {
      const data = notification.request.content.data as NotificationData | undefined;
      if (!data?.type || !data.assignmentId) return;

      const assignmentId = data.assignmentId;
      if (!shouldEnqueue(data.type, assignmentId)) return;

      switch (data.type) {
        case 'field_entry':
          mobileLogger.flow('Geofence: entered field', {
            assignmentId,
            parcelName: data.parcelName,
          });
          setAlertQueue((q) => [
            ...q,
            {
              type: 'field_entry',
              parcelName: data.parcelName ?? 'Câmp',
              assignmentId,
            },
          ]);
          break;
        case 'deposit_entry':
          mobileLogger.flow('Geofence: entered deposit', {
            assignmentId,
            tripId: data.tripId,
          });
          setAlertQueue((q) => [
            ...q,
            {
              type: 'deposit_entry',
              parcelName: 'Depozit',
              assignmentId,
              tripId: data.tripId ?? null,
            },
          ]);
          break;
        case 'geofence_exit_confirm':
          mobileLogger.flow('Geofence: exit confirm foreground', {
            assignmentId,
            parcelName: data.parcelName,
          });
          setAlertQueue((q) => [
            ...q,
            {
              type: 'exit_confirm',
              parcelName: data.parcelName ?? 'Câmp',
              assignmentId,
            },
          ]);
          break;
      }
    });

    // Handle notification taps (app was in background).
    // Taps are intentional user actions — debounce still applies to prevent
    // double-enqueue if the OS delivers both a foreground and a tap event.
    const tapSubscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as NotificationData | undefined;
      if (!data?.type || !data.assignmentId) return;

      const assignmentId = data.assignmentId;
      if (!shouldEnqueue(data.type, assignmentId)) return;

      if (data.type === 'geofence_exit_confirm') {
        // Show the exit modal so user can enter bale count
        setAlertQueue((q) => [
          ...q,
          {
            type: 'exit_confirm',
            parcelName: data.parcelName ?? 'Câmp',
            assignmentId,
          },
        ]);
      } else if (data.type === 'deposit_entry') {
        // Tapping the deposit push opens the arrival popup.
        setAlertQueue((q) => [
          ...q,
          {
            type: 'deposit_entry',
            parcelName: 'Depozit',
            assignmentId,
            tripId: data.tripId ?? null,
          },
        ]);
      }
    });

    return () => {
      fgSubscription.remove();
      tapSubscription.remove();
    };
  }, []);

  return { activeAlert, dismissAlert, confirmParcelDone };
}

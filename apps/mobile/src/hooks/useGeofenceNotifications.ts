import { useEffect, useState, useCallback } from 'react';
import { addNotificationResponseListener, addNotificationListener } from '@/lib/notifications';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth-store';

interface NotificationData {
  type?: string;
  assignmentId?: string;
  parcelName?: string;
}

export interface GeofenceAlert {
  type: 'field_entry' | 'exit_confirm' | 'deposit_entry';
  parcelName: string;
  assignmentId: string;
}

/**
 * Listens for geofence-related notifications and exposes an active alert
 * that the UI can display (banner for entry, modal for exit confirmation).
 */
export function useGeofenceNotifications() {
  const [alertQueue, setAlertQueue] = useState<GeofenceAlert[]>([]);
  const activeAlert = alertQueue[0] ?? null;
  const userId = useAuthStore((s) => s.userId);

  useEffect(() => {
    if (!userId) {
      setAlertQueue([]);
    }
  }, [userId]);

  const dismissAlert = useCallback(() => {
    setAlertQueue(q => q.slice(1));
  }, []);

  const confirmParcelDone = useCallback(
    async (assignmentId: string, baleCount?: number) => {
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
      setAlertQueue(q => q.slice(1));
    },
    [],
  );

  useEffect(() => {
    // Handle foreground notifications → show UI alert
    const fgSubscription = addNotificationListener((notification) => {
      const data = notification.request.content.data as NotificationData | undefined;
      if (!data?.type || !data.assignmentId) return;

      const assignmentId = data.assignmentId;

      switch (data.type) {
        case 'field_entry':
          mobileLogger.flow('Geofence: entered field', {
            assignmentId,
            parcelName: data.parcelName,
          });
          setAlertQueue(q => [...q, {
            type: 'field_entry',
            parcelName: data.parcelName ?? 'Câmp',
            assignmentId,
          }]);
          break;
        case 'deposit_entry':
          mobileLogger.flow('Geofence: entered deposit', {
            assignmentId,
          });
          setAlertQueue(q => [...q, {
            type: 'deposit_entry',
            parcelName: 'Depozit',
            assignmentId,
          }]);
          break;
        case 'geofence_exit_confirm':
          mobileLogger.flow('Geofence: exit confirm foreground', {
            assignmentId,
            parcelName: data.parcelName,
          });
          setAlertQueue(q => [...q, {
            type: 'exit_confirm',
            parcelName: data.parcelName ?? 'Câmp',
            assignmentId,
          }]);
          break;
      }
    });

    // Handle notification taps (app was in background)
    const tapSubscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as NotificationData | undefined;
      if (!data?.type || !data.assignmentId) return;

      const assignmentId = data.assignmentId;

      if (data.type === 'geofence_exit_confirm') {
        // Show the exit modal so user can enter bale count
        setAlertQueue(q => [...q, {
          type: 'exit_confirm',
          parcelName: data.parcelName ?? 'Câmp',
          assignmentId,
        }]);
      }
    });

    return () => {
      fgSubscription.remove();
      tapSubscription.remove();
    };
  }, []);

  return { activeAlert, dismissAlert, confirmParcelDone };
}

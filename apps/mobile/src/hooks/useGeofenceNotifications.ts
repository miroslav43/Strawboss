import { useEffect } from 'react';
import { addNotificationResponseListener } from '@/lib/notifications';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';

/**
 * Listens for notification responses related to geofence exit confirmations.
 * When operator taps the notification (confirmation action), it calls
 * POST /notifications/confirm-parcel-done to mark the parcel as harvested.
 */
export function useGeofenceNotifications() {
  useEffect(() => {
    const subscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as {
        type?: string;
        assignmentId?: string;
      } | undefined;

      if (data?.type === 'geofence_exit_confirm' && data.assignmentId) {
        mobileLogger.flow('Geofence notification tapped — confirm parcel done', {
          assignmentId: data.assignmentId,
        });
        // User tapped the notification — confirm the parcel is done
        mobileApiClient
          .post('/api/v1/notifications/confirm-parcel-done', {
            assignmentId: data.assignmentId,
          })
          .catch(() => {
            // Best-effort confirmation
          });
      }
    });

    return () => subscription.remove();
  }, []);
}

/**
 * Local notification model used by the in-app notification center
 * (bell badge + /notifications page). Persisted in SQLite via
 * `NotificationsRepo`; populated from incoming Expo push events by
 * `notification-handler.ts`.
 *
 * Keep `MobileNotificationType` values in lockstep with the `data.type`
 * payload sent by the backend (`backend/service/src/notifications` and
 * `backend/service/src/geofence`) — unrecognised types are dropped on
 * the floor by `resolveTypeAndCategory`.
 */

export enum MobileNotificationCategory {
  geofence = 'geofence',
  task = 'task',
  trip_state = 'trip_state',
  admin = 'admin',
  system = 'system',
}

export enum MobileNotificationType {
  parcel_entered = 'parcel_entered',
  parcel_exit_confirm = 'parcel_exit_confirm',
  deposit_entered = 'deposit_entered',
  assignment_created = 'assignment_created',
  truck_arrived_at_loader = 'truck_arrived_at_loader',
  trip_loaded = 'trip_loaded',
  trip_departed = 'trip_departed',
  trip_arrived = 'trip_arrived',
  trip_completed = 'trip_completed',
  trip_disputed = 'trip_disputed',
  broadcast = 'broadcast',
}

export enum MobileNotificationSeverity {
  info = 'info',
  warning = 'warning',
  critical = 'critical',
  success = 'success',
}

export interface MobileNotification {
  id: string;
  category: MobileNotificationCategory;
  type: MobileNotificationType;
  title: string;
  body: string;
  /** JSON-encoded `data` payload from the original push (tripId, plate, etc.). */
  dataJson: string | null;
  severity: MobileNotificationSeverity;
  isRead: boolean;
  /** Epoch ms when the notification was marked read; null while unread. */
  readAt: number | null;
  /** Epoch ms when the notification was inserted locally. */
  createdAt: number;
}

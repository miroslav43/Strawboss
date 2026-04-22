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
  trip_loaded = 'trip_loaded',
  trip_arrived = 'trip_arrived',
  trip_completed = 'trip_completed',
  trip_disputed = 'trip_disputed',
  broadcast = 'broadcast',
}

export enum MobileNotificationSeverity {
  info = 'info',
  success = 'success',
  warning = 'warning',
  critical = 'critical',
}

export interface MobileNotification {
  id: string;
  category: MobileNotificationCategory;
  type: MobileNotificationType;
  title: string;
  body: string;
  dataJson: string | null;
  severity: MobileNotificationSeverity;
  isRead: boolean;
  readAt: number | null;
  createdAt: number;
}

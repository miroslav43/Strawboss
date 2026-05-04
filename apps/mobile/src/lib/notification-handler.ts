import type { Notification } from 'expo-notifications';
import { MobileNotificationCategory, MobileNotificationSeverity, MobileNotificationType } from '@/types/notifications';
import { NotificationsRepo } from '../db/notifications-repo';
import { getDatabase } from './storage';

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToNotificationChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) fn();
}

/** Call after directly inserting notifications into SQLite to refresh all subscribers (e.g. bell icon). */
export function broadcastNotificationRefresh(): void {
  notifyListeners();
}

interface PushData {
  type?: string;
  assignmentId?: string;
  parcelName?: string;
  tripId?: string;
  [key: string]: unknown;
}

function resolveTypeAndCategory(pushType: string): {
  type: MobileNotificationType;
  category: MobileNotificationCategory;
  severity: MobileNotificationSeverity;
} | null {
  switch (pushType) {
    case 'field_entry':
      return { type: MobileNotificationType.parcel_entered, category: MobileNotificationCategory.geofence, severity: MobileNotificationSeverity.info };
    case 'geofence_exit_confirm':
      return { type: MobileNotificationType.parcel_exit_confirm, category: MobileNotificationCategory.geofence, severity: MobileNotificationSeverity.warning };
    case 'deposit_entry':
      return { type: MobileNotificationType.deposit_entered, category: MobileNotificationCategory.geofence, severity: MobileNotificationSeverity.info };
    case 'assignment_created':
      return { type: MobileNotificationType.assignment_created, category: MobileNotificationCategory.task, severity: MobileNotificationSeverity.info };
    case 'trip_loaded':
      return { type: MobileNotificationType.trip_loaded, category: MobileNotificationCategory.trip_state, severity: MobileNotificationSeverity.info };
    case 'trip_arrived':
      return { type: MobileNotificationType.trip_arrived, category: MobileNotificationCategory.trip_state, severity: MobileNotificationSeverity.info };
    case 'trip_completed':
      return { type: MobileNotificationType.trip_completed, category: MobileNotificationCategory.trip_state, severity: MobileNotificationSeverity.success };
    case 'trip_disputed':
      return { type: MobileNotificationType.trip_disputed, category: MobileNotificationCategory.trip_state, severity: MobileNotificationSeverity.critical };
    case 'broadcast':
      return { type: MobileNotificationType.broadcast, category: MobileNotificationCategory.admin, severity: MobileNotificationSeverity.info };
    default:
      return null;
  }
}

export async function handleIncomingPush(notification: Notification): Promise<void> {
  const content = notification.request.content;
  const data = (content.data ?? {}) as PushData;
  const pushType = data.type;

  if (!pushType) return;

  const resolved = resolveTypeAndCategory(pushType);
  if (!resolved) return;

  const id = (data.id as string | undefined) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const db = await getDatabase();
    const repo = new NotificationsRepo(db);
    await repo.insert({
      id,
      category: resolved.category,
      type: resolved.type,
      title: content.title ?? '',
      body: content.body ?? '',
      dataJson: JSON.stringify(data),
      severity: resolved.severity,
      createdAt: Date.now(),
    });
    notifyListeners();
  } catch {
    // Best-effort — never throw from a notification handler
  }
}

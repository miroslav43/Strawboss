import type { Notification } from 'expo-notifications';
import {
  MobileNotificationCategory,
  MobileNotificationSeverity,
  MobileNotificationType,
} from '@/types/notifications';
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
      return {
        type: MobileNotificationType.parcel_entered,
        category: MobileNotificationCategory.geofence,
        severity: MobileNotificationSeverity.info,
      };
    case 'geofence_exit_confirm':
      return {
        type: MobileNotificationType.parcel_exit_confirm,
        category: MobileNotificationCategory.geofence,
        severity: MobileNotificationSeverity.warning,
      };
    case 'deposit_entry':
      return {
        type: MobileNotificationType.deposit_entered,
        category: MobileNotificationCategory.geofence,
        severity: MobileNotificationSeverity.info,
      };
    // Previously dropped from history (audit #6): the baler T6 entry/exit pushes
    // and the loader field-exit confirm now land in the notification centre.
    case 'field_entry_confirm':
      return {
        type: MobileNotificationType.parcel_entered,
        category: MobileNotificationCategory.geofence,
        severity: MobileNotificationSeverity.info,
      };
    case 'field_exit_production':
    case 'loader_exit_confirm':
      return {
        type: MobileNotificationType.parcel_exit_confirm,
        category: MobileNotificationCategory.geofence,
        severity: MobileNotificationSeverity.warning,
      };
    case 'parcel_load_mismatch':
      return {
        type: MobileNotificationType.parcel_load_mismatch,
        category: MobileNotificationCategory.system,
        severity: MobileNotificationSeverity.warning,
      };
    case 'assignment_created':
      return {
        type: MobileNotificationType.assignment_created,
        category: MobileNotificationCategory.task,
        severity: MobileNotificationSeverity.info,
      };
    case 'trip_loaded':
      return {
        type: MobileNotificationType.trip_loaded,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'trip_departed':
      return {
        type: MobileNotificationType.trip_departed,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'trip_arrived':
      return {
        type: MobileNotificationType.trip_arrived,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'truck_arrived_at_loader':
      return {
        type: MobileNotificationType.truck_arrived_at_loader,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'truck_approaching_loader':
      return {
        type: MobileNotificationType.truck_approaching_loader,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'trip_completed':
      return {
        type: MobileNotificationType.trip_completed,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.success,
      };
    case 'trip_disputed':
      return {
        type: MobileNotificationType.trip_disputed,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.critical,
      };
    case 'broadcast':
      return {
        type: MobileNotificationType.broadcast,
        category: MobileNotificationCategory.admin,
        severity: MobileNotificationSeverity.info,
      };
    // Plan C (#14) — loader recall flow. Previously unhandled, so these pushes
    // were dropped before reaching SQLite and the loader could never answer.
    case 'loader_recall_prompt':
      return {
        type: MobileNotificationType.loader_recall_prompt,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.warning,
      };
    case 'trip_next_iteration':
      return {
        type: MobileNotificationType.trip_next_iteration,
        category: MobileNotificationCategory.trip_state,
        severity: MobileNotificationSeverity.info,
      };
    case 'truck_idle':
      return {
        type: MobileNotificationType.truck_idle,
        category: MobileNotificationCategory.system,
        severity: MobileNotificationSeverity.warning,
      };
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

  // Prefer an explicit id from the server (ideal — avoids all client-side derivation).
  // When absent, derive a deterministic key from the notification's semantic content so
  // that INSERT OR IGNORE in SQLite suppresses duplicates across retries/re-deliveries.
  // Format: "<pushType>-<assignmentId|tripId|title-hash>" — stable for the same event.
  const serverId = data.id as string | undefined;
  const id =
    serverId ??
    (() => {
      const anchor = data.assignmentId ?? data.tripId ?? null;
      if (anchor) return `${pushType}-${anchor}`;
      // Fallback: hash title+body for broadcasts and other types without a domain id
      const raw = `${content.title ?? ''}|${content.body ?? ''}|${pushType}`;
      let h = 0;
      for (let i = 0; i < raw.length; i++) {
        h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
      }
      return `${pushType}-${(h >>> 0).toString(16)}`;
    })();

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

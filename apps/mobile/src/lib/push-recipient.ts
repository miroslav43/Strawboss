import { useAuthStore } from '@/stores/auth-store';

/**
 * Recipient guard for shared devices.
 *
 * The backend stamps `recipientUserId` on every user-targeted push
 * (`NotificationsService.sendPush`). A physical Expo push token can linger
 * `is_active = true` under a previous user — the cross-user cleanup in
 * `registerToken` is skipped whenever a fresh login can't obtain a token
 * (missing FCM creds / denied permission / dev). So a push aimed at user A can
 * physically land on a phone now held by user B. This guard rejects it before
 * it is shown or stored.
 *
 * Fail-open: reject ONLY when we positively know the push is for someone else —
 * `recipientUserId` is present, a local user is known, and they differ. An
 * absent id (broadcasts, silent fleet wakes, an older backend) or an unknown
 * local user (cold start before the persisted auth store has rehydrated) →
 * allow, so a legitimate notification is never hidden.
 */
export function isPushForCurrentUser(data: Record<string, unknown> | null | undefined): boolean {
  const recipientId = typeof data?.recipientUserId === 'string' ? data.recipientUserId : null;
  if (!recipientId) return true;
  const currentUserId = useAuthStore.getState().userId;
  if (!currentUserId) return true;
  return recipientId === currentUserId;
}

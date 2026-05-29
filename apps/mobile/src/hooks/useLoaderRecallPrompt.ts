import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/lib/storage';
import { NotificationsRepo } from '@/db/notifications-repo';
import { subscribeToNotificationChanges } from '@/lib/notification-handler';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';

export interface LoaderRecallPromptState {
  notificationId: string;
  tripId: string;
  truckCode: string;
}

/**
 * Plan C (#14) — surfaces the latest unread "loader_recall_prompt" push so the
 * loader UI can render a blocking card. Loads from the local notifications
 * table on mount and re-checks on every incoming push
 * (subscribeToNotificationChanges) so the overlay appears in real time.
 * Replying POSTs /notifications/loader-recall-response and dismisses locally.
 */
export function useLoaderRecallPrompt() {
  const [state, setState] = useState<LoaderRecallPromptState | null>(null);
  const [pending, setPending] = useState(false);
  // Guards against setState after unmount when an async load()/respond() settles.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      const recent = await repo.listRecent(20);
      const hit = recent.find((n) => !n.isRead && String(n.type) === 'loader_recall_prompt');
      if (!mountedRef.current) return;
      if (!hit) {
        setState(null);
        return;
      }
      const data = hit.dataJson ? (JSON.parse(hit.dataJson) as Record<string, unknown>) : {};
      setState({
        notificationId: hit.id,
        tripId: String(data.tripId ?? ''),
        truckCode: String(data.truckCode ?? '—'),
      });
    } catch (err) {
      mobileLogger.warn('useLoaderRecallPrompt load failed', { err });
    }
  }, []);

  useEffect(() => {
    void load();
    // Re-check whenever a push lands (handleIncomingPush → notifyListeners) so
    // the overlay appears in real time, not only on mount.
    const unsubscribe = subscribeToNotificationChanges(() => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const respond = useCallback(
    async (recall: boolean) => {
      if (!state || pending) return;
      const { notificationId, tripId } = state;
      setPending(true);

      // Dismiss locally: mark read (best-effort) then clear the overlay no
      // matter what — a SQLite failure must never leave the loader stuck behind
      // a blocking overlay.
      const dismiss = async () => {
        try {
          const db = await getDatabase();
          await new NotificationsRepo(db).markAsRead(notificationId);
        } catch (err) {
          mobileLogger.warn('useLoaderRecallPrompt markAsRead failed', { err });
        }
        if (mountedRef.current) setState(null);
      };

      try {
        await mobileApiClient.post('/api/v1/notifications/loader-recall-response', {
          tripId,
          recall,
        });
        await dismiss();
      } catch (err) {
        // 409 = the server already recorded an answer for this trip
        // (recall_already_decided). Treat as done and dismiss; otherwise the
        // overlay would re-surface and POST forever. Other errors (network) are
        // left up so the loader can retry.
        const status = (err as { status?: number } | null)?.status;
        if (status === 409) {
          await dismiss();
        } else {
          mobileLogger.error('loader-recall-response failed', { err });
        }
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [state, pending],
  );

  return { prompt: state, respond, refresh: load, pending } as const;
}

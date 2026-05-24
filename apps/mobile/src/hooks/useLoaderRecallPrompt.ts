import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '@/lib/storage';
import { NotificationsRepo } from '@/db/notifications-repo';
import { mobileApiClient } from '@/lib/api-client';
import { mobileLogger } from '@/lib/logger';

export interface LoaderRecallPromptState {
  notificationId: string;
  tripId: string;
  truckCode: string;
}

/**
 * Plan C — surfaces the latest unread "loader_recall_prompt" push so the
 * loader UI can render a card. Polls the local notifications table once on
 * mount and then on `refresh()`. Replying calls
 * POST /notifications/loader-recall-response and marks the notification
 * read locally.
 */
export function useLoaderRecallPrompt() {
  const [state, setState] = useState<LoaderRecallPromptState | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      const recent = await repo.listRecent(20);
      const hit = recent.find((n) => !n.isRead && String(n.type) === 'loader_recall_prompt');
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
  }, [load]);

  const respond = useCallback(
    async (recall: boolean) => {
      if (!state || pending) return;
      setPending(true);
      try {
        await mobileApiClient.post('/api/v1/notifications/loader-recall-response', {
          tripId: state.tripId,
          recall,
        });
        const db = await getDatabase();
        const repo = new NotificationsRepo(db);
        await repo.markAsRead(state.notificationId);
        setState(null);
      } catch (err) {
        mobileLogger.error('loader-recall-response failed', { err });
      } finally {
        setPending(false);
      }
    },
    [state, pending],
  );

  return { prompt: state, respond, refresh: load, pending } as const;
}

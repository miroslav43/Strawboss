import { useState, useEffect, useCallback } from 'react';
import type { MobileNotification } from '@/types/notifications';
import { NotificationsRepo } from '../db/notifications-repo';
import { getDatabase } from '../lib/storage';
import { subscribeToNotificationChanges } from '../lib/notification-handler';

export function useNotifications() {
  const [items, setItems] = useState<MobileNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      const [list, count] = await Promise.all([repo.listRecent(100), repo.countUnread()]);
      setItems(list);
      setUnreadCount(count);
    } catch {
      // Ignore db errors in background refresh
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      await repo.markAsRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true, readAt: Date.now() } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // Ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      await repo.markAllAsRead();
      const now = Date.now();
      setItems(prev => prev.map(n => n.isRead ? n : { ...n, isRead: true, readAt: now }));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    try {
      const db = await getDatabase();
      const repo = new NotificationsRepo(db);
      await repo.delete(id);
      setItems(prev => {
        const removed = prev.find(n => n.id === id);
        const next = prev.filter(n => n.id !== id);
        if (removed && !removed.isRead) {
          setUnreadCount(c => Math.max(0, c - 1));
        }
        return next;
      });
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeToNotificationChanges(refresh);
    return unsub;
  }, [refresh]);

  return { items, unreadCount, markAsRead, markAllAsRead, deleteNotification, refresh };
}

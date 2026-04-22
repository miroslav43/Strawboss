import type * as SQLite from 'expo-sqlite';
import type { MobileNotification, MobileNotificationCategory, MobileNotificationSeverity, MobileNotificationType } from '@/types/notifications';

interface NotificationRow {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string;
  data_json: string | null;
  severity: string;
  is_read: number;
  read_at: number | null;
  created_at: number;
}

function rowToNotification(row: NotificationRow): MobileNotification {
  return {
    id: row.id,
    category: row.category as MobileNotificationCategory,
    type: row.type as MobileNotificationType,
    title: row.title,
    body: row.body,
    dataJson: row.data_json,
    severity: row.severity as MobileNotificationSeverity,
    isRead: row.is_read === 1,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export interface InsertNotificationInput {
  id: string;
  category: MobileNotificationCategory;
  type: MobileNotificationType;
  title: string;
  body: string;
  dataJson?: string | null;
  severity: MobileNotificationSeverity;
  createdAt?: number;
}

export class NotificationsRepo {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async insert(input: InsertNotificationInput): Promise<void> {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO notifications (id, category, type, title, body, data_json, severity, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        input.id,
        input.category,
        input.type,
        input.title,
        input.body,
        input.dataJson ?? null,
        input.severity,
        input.createdAt ?? Date.now(),
      ],
    );
  }

  async listRecent(limit = 50): Promise<MobileNotification[]> {
    const rows = await this.db.getAllAsync<NotificationRow>(
      `SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(rowToNotification);
  }

  async countUnread(): Promise<number> {
    const result = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM notifications WHERE is_read = 0`,
    );
    return result?.count ?? 0;
  }

  async markAsRead(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?`,
      [Date.now(), id],
    );
  }

  async markAllAsRead(): Promise<void> {
    await this.db.runAsync(
      `UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0`,
      [Date.now()],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM notifications WHERE id = ?`, [id]);
  }

  async cleanupOlderThan(ageMs: number): Promise<void> {
    const cutoff = Date.now() - ageMs;
    await this.db.runAsync(
      `DELETE FROM notifications WHERE created_at < ?`,
      [cutoff],
    );
  }
}

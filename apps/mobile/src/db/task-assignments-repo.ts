import type * as SQLite from 'expo-sqlite';

type SQLiteBindValue = string | number | null | boolean | Uint8Array;

export interface LocalTaskAssignment {
  id: string;
  assignment_date: string;
  machine_id: string | null;
  parcel_id: string | null;
  assigned_user_id: string | null;
  priority: string;
  sequence_order: number;
  estimated_start: string | null;
  estimated_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  server_version: number;
}

export class TaskAssignmentsRepo {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async upsert(data: LocalTaskAssignment): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO task_assignments (
        id, assignment_date, machine_id, parcel_id, assigned_user_id,
        priority, sequence_order, estimated_start, estimated_end,
        actual_start, actual_end, notes,
        created_at, updated_at, server_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        assignment_date = excluded.assignment_date,
        machine_id = excluded.machine_id,
        parcel_id = excluded.parcel_id,
        assigned_user_id = excluded.assigned_user_id,
        priority = excluded.priority,
        sequence_order = excluded.sequence_order,
        estimated_start = excluded.estimated_start,
        estimated_end = excluded.estimated_end,
        actual_start = excluded.actual_start,
        actual_end = excluded.actual_end,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        server_version = excluded.server_version`,
      [
        data.id,
        data.assignment_date,
        data.machine_id,
        data.parcel_id,
        data.assigned_user_id,
        data.priority,
        data.sequence_order,
        data.estimated_start,
        data.estimated_end,
        data.actual_start,
        data.actual_end,
        data.notes,
        data.created_at,
        data.updated_at,
        data.server_version,
      ] as SQLiteBindValue[]
    );
  }

  async findById(id: string): Promise<LocalTaskAssignment | null> {
    const result = await this.db.getFirstAsync<LocalTaskAssignment>(
      `SELECT * FROM task_assignments WHERE id = ?`,
      [id]
    );
    return result ?? null;
  }

  async listByUser(userId: string): Promise<LocalTaskAssignment[]> {
    return this.db.getAllAsync<LocalTaskAssignment>(
      `SELECT * FROM task_assignments WHERE assigned_user_id = ? ORDER BY assignment_date DESC, sequence_order ASC`,
      [userId]
    );
  }

  async listAll(): Promise<LocalTaskAssignment[]> {
    return this.db.getAllAsync<LocalTaskAssignment>(
      `SELECT * FROM task_assignments ORDER BY assignment_date DESC, sequence_order ASC`
    );
  }

  async listByDate(date: string): Promise<LocalTaskAssignment[]> {
    return this.db.getAllAsync<LocalTaskAssignment>(
      `SELECT * FROM task_assignments WHERE assignment_date = ? ORDER BY sequence_order ASC`,
      [date],
    );
  }

  async getMaxServerVersion(): Promise<number> {
    const result = await this.db.getFirstAsync<{ max_ver: number }>(
      `SELECT COALESCE(MAX(server_version), 0) as max_ver FROM task_assignments`
    );
    return result?.max_ver ?? 0;
  }
}

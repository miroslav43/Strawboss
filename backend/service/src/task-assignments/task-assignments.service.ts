import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class TaskAssignmentsService {
  constructor(private readonly drizzleProvider: DrizzleProvider) {}

  async list(filters?: {
    assignmentDate?: string;
    machineId?: string;
    assignedUserId?: string;
  }) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (filters?.assignmentDate) {
      conditions.push(sql`assignment_date = ${filters.assignmentDate}`);
    }
    if (filters?.machineId) {
      conditions.push(sql`machine_id = ${filters.machineId}`);
    }
    if (filters?.assignedUserId) {
      conditions.push(sql`assigned_user_id = ${filters.assignedUserId}`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM task_assignments WHERE ${where} ORDER BY sequence_order ASC, created_at DESC`,
    );
    return result;
  }

  async getBoard(date: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.*,
        p.name as parcel_name,
        p.code as parcel_code,
        m.internal_code as machine_code,
        m.machine_type,
        u.full_name as assigned_user_name
      FROM task_assignments ta
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      WHERE ta.assignment_date = ${date}
        AND ta.deleted_at IS NULL
      ORDER BY ta.parcel_id, ta.sequence_order ASC`,
    );
    return result;
  }

  async findById(id: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM task_assignments WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const rows = result as unknown as Record<string, unknown>[];
    if (!rows.length) {
      throw new NotFoundException(`TaskAssignment ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: Record<string, unknown>) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO task_assignments (
        assignment_date, machine_id, parcel_id, assigned_user_id,
        priority, sequence_order, estimated_start, estimated_end, notes
      ) VALUES (
        ${dto.assignmentDate}, ${dto.machineId}, ${dto.parcelId},
        ${dto.assignedUserId}, ${dto.priority}, ${dto.sequenceOrder},
        ${dto.estimatedStart ?? null}, ${dto.estimatedEnd ?? null},
        ${dto.notes ?? null}
      ) RETURNING *`,
    );
    return result;
  }

  async bulkCreate(dtos: Record<string, unknown>[]) {
    const results: unknown[] = [];
    for (const dto of dtos) {
      const result = await this.create(dto);
      results.push(result);
    }
    return results;
  }

  async update(id: string, dto: Record<string, unknown>) {
    await this.findById(id);

    const setClauses: ReturnType<typeof sql>[] = [];
    const fieldMap: Record<string, string> = {
      assignmentDate: 'assignment_date',
      machineId: 'machine_id',
      parcelId: 'parcel_id',
      assignedUserId: 'assigned_user_id',
      priority: 'priority',
      sequenceOrder: 'sequence_order',
      estimatedStart: 'estimated_start',
      estimatedEnd: 'estimated_end',
      actualStart: 'actual_start',
      actualEnd: 'actual_end',
      notes: 'notes',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        setClauses.push(sql`${sql.raw(column)} = ${dto[key] as string | number | boolean | null}`);
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    return result;
  }

  async softDelete(id: string) {
    await this.findById(id);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id} RETURNING *`,
    );
    return result;
  }
}

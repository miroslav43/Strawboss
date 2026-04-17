import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';

@Injectable()
export class TaskAssignmentsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) {}

  async list(filters?: {
    assignmentDate?: string;
    machineId?: string;
    assignedUserId?: string;
    status?: string;
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
    if (filters?.status) {
      conditions.push(sql`status = ${filters.status}::task_assignment_status`);
    }

    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM task_assignments WHERE ${where} ORDER BY sequence_order ASC, created_at DESC LIMIT 1000`,
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

  async getDailyPlan(date: string) {
    // Fetch all assignments for the date with joined machine/parcel/user data
    const assignments = await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.id,
        ta.assignment_date as "assignmentDate",
        ta.machine_id as "machineId",
        ta.parcel_id as "parcelId",
        ta.assigned_user_id as "assignedUserId",
        ta.priority,
        ta.sequence_order as "sequenceOrder",
        ta.status,
        ta.parent_assignment_id as "parentAssignmentId",
        ta.destination_id as "destinationId",
        ta.estimated_start as "estimatedStart",
        ta.estimated_end as "estimatedEnd",
        ta.actual_start as "actualStart",
        ta.actual_end as "actualEnd",
        ta.notes,
        ta.created_at as "createdAt",
        ta.updated_at as "updatedAt",
        m.internal_code as "machineCode",
        m.machine_type as "machineType",
        m.registration_plate as "registrationPlate",
        p.name as "parcelName",
        p.code as "parcelCode",
        u.full_name as "assignedUserName",
        dd.name as "destinationName",
        dd.code as "destinationCode"
      FROM task_assignments ta
      JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      LEFT JOIN delivery_destinations dd ON ta.destination_id = dd.id
      WHERE ta.assignment_date = ${date}
        AND ta.deleted_at IS NULL
      ORDER BY ta.sequence_order ASC, ta.created_at ASC`,
    );

    // Latest parcel_daily_status row per parcel on or before this plan date (carry-forward “done”)
    const parcelStatuses = await this.drizzleProvider.db.execute(
      sql`SELECT DISTINCT ON (parcel_id)
        parcel_id AS "parcelId",
        is_done AS "isDone"
      FROM parcel_daily_status
      WHERE status_date <= ${date}
      ORDER BY parcel_id, status_date DESC`,
    );

    // Parcels explicitly tracked for this date but with no in_progress rows (e.g. only “done” / empty shell)
    const parcelDayShells = await this.drizzleProvider.db.execute(
      sql`SELECT
        p.id AS "parcelId",
        p.name AS "parcelName",
        p.code AS "parcelCode"
      FROM parcel_daily_status pds
      JOIN parcels p ON p.id = pds.parcel_id AND p.deleted_at IS NULL
      WHERE pds.status_date = ${date}`,
    );

    // Fetch all active machines to determine which are unassigned
    const allMachines = await this.drizzleProvider.db.execute(
      sql`SELECT
        id,
        machine_type as "machineType",
        internal_code as "internalCode",
        registration_plate as "registrationPlate"
      FROM machines
      WHERE is_active = true AND deleted_at IS NULL
      ORDER BY machine_type, internal_code`,
    );

    const rows = assignments as unknown as Record<string, unknown>[];
    const statusRows = parcelStatuses as unknown as Record<string, unknown>[];
    const shellRows = parcelDayShells as unknown as Record<string, unknown>[];
    const machineRows = allMachines as unknown as Record<string, unknown>[];

    const effectiveDoneByParcel = new Map<string, boolean>();
    for (const s of statusRows) {
      effectiveDoneByParcel.set(s.parcelId as string, s.isDone as boolean);
    }

    // Set of assigned machine IDs
    const assignedMachineIds = new Set(rows.map((r) => r.machineId as string));

    // Available = active machines with no assignment for this date
    const available = machineRows
      .filter((m) => !assignedMachineIds.has(m.id as string))
      .map((m) => ({
        machine: {
          id: m.id,
          machineType: m.machineType,
          internalCode: m.internalCode,
          registrationPlate: m.registrationPlate,
        },
      }));

    // Build assignment lookup
    const assignmentMap = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      assignmentMap.set(row.id as string, row);
    }

    // Group in-progress assignments by parcel, with hierarchy
    const inProgressRows = rows.filter((r) => r.status === 'in_progress');
    const doneRows = rows.filter((r) => r.status === 'done');

    // Build parcel groups for in_progress
    const parcelGroups = new Map<string, {
      parcelId: string;
      parcelName: string;
      parcelCode: string;
      assignments: Record<string, unknown>[];
    }>();

    for (const row of inProgressRows) {
      const pId = row.parcelId as string;
      if (!pId) continue;
      if (!parcelGroups.has(pId)) {
        parcelGroups.set(pId, {
          parcelId: pId,
          parcelName: (row.parcelName as string) ?? '',
          parcelCode: (row.parcelCode as string) ?? '',
          assignments: [],
        });
      }
      parcelGroups.get(pId)!.assignments.push(row);
    }

    // Keep parcel rows for this calendar day even when every machine was moved back (status row exists)
    for (const shell of shellRows) {
      const pid = shell.parcelId as string;
      if (!parcelGroups.has(pid)) {
        parcelGroups.set(pid, {
          parcelId: pid,
          parcelName: (shell.parcelName as string) ?? '',
          parcelCode: (shell.parcelCode as string) ?? '',
          assignments: [],
        });
      }
    }

    // Build hierarchy within each parcel group
    const inProgress = Array.from(parcelGroups.values()).map((group) => {
      const isDoneEffective = effectiveDoneByParcel.get(group.parcelId) ?? false;
      // Root assignments = those with no parent (balers). If parent was removed, show machines flat.
      let roots = group.assignments.filter((a) => !a.parentAssignmentId);
      if (roots.length === 0 && group.assignments.length > 0) {
        roots = group.assignments;
      }
      const buildTree = (parentId: string): Record<string, unknown>[] => {
        return group.assignments
          .filter((a) => (a.parentAssignmentId as string) === parentId)
          .map((a) => ({
            ...a,
            children: buildTree(a.id as string),
          }));
      };

      return {
        parcelId: group.parcelId,
        parcelName: group.parcelName,
        parcelCode: group.parcelCode,
        isDone: isDoneEffective,
        assignments: roots.map((r) => ({
          ...r,
          children: buildTree(r.id as string),
        })),
      };
    });

    // Done = flat list
    const done = doneRows.map((r) => ({
      ...r,
      machine: {
        id: r.machineId,
        machineType: r.machineType,
        internalCode: r.machineCode,
        registrationPlate: r.registrationPlate,
      },
    }));

    // Assignments with no parcel (e.g. trucks planned without a source field).
    // They are NOT part of any parcel group, so admin-web's parcel view skips them,
    // but mobile clients still need to see them on the assigned operator's screen.
    const unassignedToParcel = rows
      .filter((r) => !r.parcelId && r.status === 'in_progress')
      .map((r) => ({
        ...r,
        machine: {
          id: r.machineId,
          machineType: r.machineType,
          internalCode: r.machineCode,
          registrationPlate: r.registrationPlate,
        },
      }));

    return {
      date,
      available,
      inProgress,
      done,
      unassignedToParcel,
      parcelStatuses: statusRows,
    };
  }

  async getByMachineType(date: string, machineType: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.id,
        ta.assignment_date as "assignmentDate",
        ta.machine_id as "machineId",
        ta.parcel_id as "parcelId",
        ta.assigned_user_id as "assignedUserId",
        ta.priority,
        ta.sequence_order as "sequenceOrder",
        ta.status,
        ta.parent_assignment_id as "parentAssignmentId",
        ta.destination_id as "destinationId",
        ta.notes,
        ta.created_at as "createdAt",
        ta.updated_at as "updatedAt",
        m.internal_code as "machineCode",
        m.machine_type as "machineType",
        m.registration_plate as "registrationPlate",
        p.name as "parcelName",
        p.code as "parcelCode",
        u.full_name as "assignedUserName",
        dd.name as "destinationName",
        dd.code as "destinationCode"
      FROM task_assignments ta
      JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      LEFT JOIN delivery_destinations dd ON ta.destination_id = dd.id
      WHERE ta.assignment_date = ${date}
        AND m.machine_type = ${machineType}
        AND ta.deleted_at IS NULL
      ORDER BY ta.machine_id, ta.sequence_order ASC`,
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

  /**
   * UNIQUE (assignment_date, machine_id, sequence_order) includes soft-deleted rows.
   * Always allocate the next order so re-assigning the same machine on a date never collides.
   */
  private async nextSequenceOrder(
    assignmentDate: string,
    machineId: string,
  ): Promise<number> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT COALESCE(MAX(sequence_order), -1) + 1 AS n
      FROM task_assignments
      WHERE assignment_date = ${assignmentDate} AND machine_id = ${machineId}
    `);
    const rows = result as unknown as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  }

  async create(dto: Record<string, unknown>) {
    const assignmentDate = dto.assignmentDate as string;
    const machineId = dto.machineId as string;
    const sequenceOrder = await this.nextSequenceOrder(assignmentDate, machineId);

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO task_assignments (
        assignment_date, machine_id, parcel_id, assigned_user_id,
        priority, sequence_order, status, parent_assignment_id,
        destination_id, estimated_start, estimated_end, notes
      ) VALUES (
        ${assignmentDate}, ${machineId}, ${dto.parcelId ?? null},
        ${dto.assignedUserId ?? null}, ${dto.priority ?? 'normal'},
        ${sequenceOrder}, ${dto.status ?? 'available'}::task_assignment_status,
        ${dto.parentAssignmentId ?? null},
        ${dto.destinationId ?? null},
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
    const before = await this.findById(id);
    const prevStatus =
      typeof before.status === 'string' ? before.status : undefined;

    const setClauses: ReturnType<typeof sql>[] = [];
    const fieldMap: Record<string, string> = {
      assignmentDate: 'assignment_date',
      machineId: 'machine_id',
      parcelId: 'parcel_id',
      assignedUserId: 'assigned_user_id',
      priority: 'priority',
      sequenceOrder: 'sequence_order',
      status: 'status',
      parentAssignmentId: 'parent_assignment_id',
      destinationId: 'destination_id',
      estimatedStart: 'estimated_start',
      estimatedEnd: 'estimated_end',
      actualStart: 'actual_start',
      actualEnd: 'actual_end',
      notes: 'notes',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in dto) {
        if (key === 'status') {
          setClauses.push(
            sql`${sql.raw(column)} = ${dto[key] as string}::task_assignment_status`,
          );
        } else {
          setClauses.push(
            sql`${sql.raw(column)} = ${dto[key] as string | number | boolean | null}`,
          );
        }
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

    if ('status' in dto && typeof dto.status === 'string' && prevStatus) {
      this.winston.log(
        'flow',
        `Task assignment ${id} status ${prevStatus} → ${dto.status}`,
        {
          context: 'TaskAssignmentsService',
          assignmentId: id,
          fromStatus: prevStatus,
          toStatus: dto.status,
        },
      );
    }

    return result;
  }

  async updateStatus(id: string, status: string) {
    const before = await this.findById(id);
    const prevStatus =
      typeof before.status === 'string' ? before.status : 'unknown';

    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${status}::task_assignment_status`,
      sql`updated_at = NOW()`,
    ];

    // Auto-set actual_start/actual_end timestamps
    if (status === 'in_progress') {
      setClauses.push(
        sql`actual_start = COALESCE(actual_start, NOW())`,
      );
    } else if (status === 'done') {
      setClauses.push(sql`actual_end = NOW()`);
    } else if (status === 'available') {
      // Moving back to available: clear parcel and parent
      setClauses.push(sql`parcel_id = NULL`);
      setClauses.push(sql`parent_assignment_id = NULL`);
      setClauses.push(sql`actual_start = NULL`);
      setClauses.push(sql`actual_end = NULL`);
    }

    const setClause = sql.join(setClauses, sql`, `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );

    // Cascade: if moving to available, also move children to available
    if (status === 'available') {
      await this.cascadeToAvailable(id);
    }

    this.winston.log(
      'flow',
      `Task assignment ${id} updateStatus ${prevStatus} → ${status}`,
      {
        context: 'TaskAssignmentsService',
        assignmentId: id,
        fromStatus: prevStatus,
        toStatus: status,
      },
    );

    return result;
  }

  private async cascadeToAvailable(parentId: string) {
    // Find all children
    const children = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM task_assignments
          WHERE parent_assignment_id = ${parentId} AND deleted_at IS NULL`,
    );
    const childRows = children as unknown as Record<string, unknown>[];
    for (const child of childRows) {
      await this.updateStatus(child.id as string, 'available');
    }
  }

  async autoCompletePastAssignments(beforeDate: string) {
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments
          SET status = 'done'::task_assignment_status,
              actual_end = COALESCE(actual_end, NOW()),
              updated_at = NOW()
          WHERE assignment_date < ${beforeDate}
            AND status = 'in_progress'::task_assignment_status
            AND deleted_at IS NULL
          RETURNING id`,
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

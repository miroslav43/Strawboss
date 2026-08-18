import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { TripsService } from '../trips/trips.service';
import { tServer } from '../common';

@Injectable()
export class TaskAssignmentsService {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
    private readonly notificationsService: NotificationsService,
    private readonly tripsService: TripsService,
  ) {}

  /**
   * Best-effort auto-upsert so admin planning flows never fail when trip
   * creation is not possible (e.g. no driver on truck yet).
   */
  private async autoUpsertTripSafe(taskId: string): Promise<void> {
    try {
      await this.tripsService.autoUpsertFromTruckTask(taskId);
    } catch (err) {
      this.winston.error(`autoUpsertFromTruckTask failed for task ${taskId}`, {
        context: 'TaskAssignmentsService',
        taskId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  }

  private async autoCancelTripSafe(taskId: string): Promise<void> {
    try {
      await this.tripsService.autoCancelForTruckTask(taskId);
    } catch (err) {
      this.winston.error(`autoCancelForTruckTask failed for task ${taskId}`, {
        context: 'TaskAssignmentsService',
        taskId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    }
  }

  async list(
    orgId: string | null,
    filters?: {
      assignmentDate?: string;
      machineId?: string;
      assignedUserId?: string;
      status?: string;
    },
  ) {
    const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

    if (orgId !== null) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
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

  /**
   * Returns task assignments for a specific date that belong to the
   * authenticated operator — either directly assigned (`assigned_user_id`)
   * or linked via the machine permanently assigned to that user
   * (`users.assigned_machine_id`). Always scoped to the caller's org.
   *
   * This is the server-side-filtered counterpart of the daily-plan endpoint
   * so the mobile `useMyTasks` hook does not have to fetch the full daily plan
   * and filter client-side.
   *
   * Response shape: flat array of task assignment rows with the same JOINed
   * fields as `getDailyPlan` produces, sorted by `sequenceOrder ASC`.
   */
  async getMyTasks(
    orgId: string | null,
    userId: string,
    date: string,
  ): Promise<Record<string, unknown>[]> {
    const conditions: ReturnType<typeof sql>[] = [
      sql`ta.assignment_date = ${date}`,
      sql`ta.deleted_at IS NULL`,
      // Include rows assigned directly to this user OR where the machine is
      // permanently assigned to this user (mirrors the mobile client-side filter).
      // The "permanently assigned" link lives on `users.assigned_machine_id`,
      // NOT on `machines.assigned_user_id` (which doesn't exist) — without the
      // table qualifier Postgres silently outer-resolves to `ta.assigned_user_id`,
      // so the OR branch never matches and operators get an empty list.
      sql`(
        ta.assigned_user_id = ${userId}::uuid
        OR ta.machine_id IN (
          SELECT assigned_machine_id FROM users
          WHERE id = ${userId}::uuid
            AND assigned_machine_id IS NOT NULL
            AND deleted_at IS NULL
        )
      )`,
    ];

    if (orgId !== null) {
      conditions.push(sql`ta.organization_id = ${orgId}::uuid`);
    }

    const where = sql.join(conditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`SELECT
        ta.id,
        ta.assignment_date       AS "assignmentDate",
        ta.machine_id            AS "machineId",
        ta.parcel_id             AS "parcelId",
        ta.assigned_user_id      AS "assignedUserId",
        ta.priority,
        ta.sequence_order        AS "sequenceOrder",
        ta.status,
        ta.parent_assignment_id  AS "parentAssignmentId",
        ta.destination_id        AS "destinationId",
        ta.estimated_start       AS "estimatedStart",
        ta.estimated_end         AS "estimatedEnd",
        ta.actual_start          AS "actualStart",
        ta.actual_end            AS "actualEnd",
        ta.notes,
        ta.created_at            AS "createdAt",
        ta.updated_at            AS "updatedAt",
        m.internal_code          AS "machineCode",
        m.machine_type           AS "machineType",
        m.registration_plate     AS "registrationPlate",
        p.name                   AS "parcelName",
        p.code                   AS "parcelCode",
        u.full_name              AS "assignedUserName",
        dd.name                  AS "destinationName",
        dd.code                  AS "destinationCode",
        -- Depot geometry so the mobile app can cache it and compute in-depot
        -- presence for depot-sourced loads (loaders) and delivery geofences
        -- (drivers). NULL for parcel-only tasks / depots without geometry.
        ST_AsGeoJSON(dd.boundary)::json AS "destinationBoundary",
        ST_AsGeoJSON(dd.coords)::json    AS "destinationCoords",
        dd.confirm_radius_m              AS "destinationConfirmRadiusM"
      FROM task_assignments ta
      JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      LEFT JOIN delivery_destinations dd ON ta.destination_id = dd.id
      WHERE ${where}
      ORDER BY ta.sequence_order ASC, ta.created_at ASC
      LIMIT 200`,
    );

    this.winston.info(
      `getMyTasks userId=${userId} date=${date} rows=${(result as unknown[]).length}`,
      {
        context: 'TaskAssignmentsService',
        userId,
        date,
      },
    );

    return result as unknown as Record<string, unknown>[];
  }

  async getBoard(orgId: string | null, date: string) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`ta.assignment_date = ${date}`,
      sql`ta.deleted_at IS NULL`,
    ];
    if (orgId !== null) {
      conditions.push(sql`ta.organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
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
      WHERE ${where}
      ORDER BY ta.parcel_id, ta.sequence_order ASC`,
    );
    return result;
  }

  async getDailyPlan(orgId: string | null, date: string) {
    const planConditions: ReturnType<typeof sql>[] = [
      sql`ta.assignment_date = ${date}`,
      sql`ta.deleted_at IS NULL`,
    ];
    if (orgId !== null) {
      planConditions.push(sql`ta.organization_id = ${orgId}::uuid`);
    }
    const planWhere = sql.join(planConditions, sql` AND `);

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
        u.last_seen_at as "assignedUserLastSeenAt",
        dd.name as "destinationName",
        dd.code as "destinationCode"
      FROM task_assignments ta
      JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      LEFT JOIN delivery_destinations dd ON ta.destination_id = dd.id
      WHERE ${planWhere}
      ORDER BY ta.sequence_order ASC, ta.created_at ASC`,
    );

    // Latest parcel_daily_status row per parcel on or before this plan date (carry-forward "done")
    // When orgId is set, JOIN to parcels to scope results to the caller's org.
    const parcelStatuses = await this.drizzleProvider.db.execute(
      orgId !== null
        ? sql`SELECT DISTINCT ON (pds.parcel_id)
        pds.parcel_id AS "parcelId",
        pds.is_done AS "isDone"
      FROM parcel_daily_status pds
      JOIN parcels p ON p.id = pds.parcel_id AND p.deleted_at IS NULL
      WHERE pds.status_date <= ${date}
        AND p.organization_id = ${orgId}::uuid
      ORDER BY pds.parcel_id, pds.status_date DESC`
        : sql`SELECT DISTINCT ON (parcel_id)
        parcel_id AS "parcelId",
        is_done AS "isDone"
      FROM parcel_daily_status
      WHERE status_date <= ${date}
      ORDER BY parcel_id, status_date DESC`,
    );

    // Parcels explicitly tracked for this date but with no in_progress rows (e.g. only "done" / empty shell)
    const parcelDayShellConditions: ReturnType<typeof sql>[] = [
      sql`pds.status_date = ${date}`,
      sql`p.deleted_at IS NULL`,
    ];
    if (orgId !== null) parcelDayShellConditions.push(sql`p.organization_id = ${orgId}::uuid`);
    const shellWhere = sql.join(parcelDayShellConditions, sql` AND `);

    const parcelDayShells = await this.drizzleProvider.db.execute(
      sql`SELECT
        p.id AS "parcelId",
        p.name AS "parcelName",
        p.code AS "parcelCode"
      FROM parcel_daily_status pds
      JOIN parcels p ON p.id = pds.parcel_id
      WHERE ${shellWhere}`,
    );

    // Fetch all active machines scoped to org (when set) to determine which are unassigned
    const machineConditions: ReturnType<typeof sql>[] = [
      sql`is_active = true`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) machineConditions.push(sql`organization_id = ${orgId}::uuid`);
    const machineWhere = sql.join(machineConditions, sql` AND `);

    const allMachines = await this.drizzleProvider.db.execute(
      sql`SELECT
        id,
        machine_type as "machineType",
        internal_code as "internalCode",
        registration_plate as "registrationPlate"
      FROM machines
      WHERE ${machineWhere}
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
    const parcelGroups = new Map<
      string,
      {
        parcelId: string;
        parcelName: string;
        parcelCode: string;
        assignments: Record<string, unknown>[];
      }
    >();

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

    // Task assignments with status='available' — mobile clients need these to
    // surface the "start task" prompt. Kept separate from `available` (unassigned
    // machines) which the admin board uses for a different purpose.
    const availableTasks = rows.filter((r) => r.status === 'available');

    return {
      date,
      available,
      inProgress,
      done,
      unassignedToParcel,
      availableTasks,
      parcelStatuses: statusRows,
    };
  }

  async getByMachineType(orgId: string | null, date: string, machineType: string) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`ta.assignment_date = ${date}`,
      sql`m.machine_type = ${machineType}`,
      sql`ta.deleted_at IS NULL`,
    ];
    if (orgId !== null) {
      conditions.push(sql`ta.organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
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
        u.last_seen_at as "assignedUserLastSeenAt",
        dd.name as "destinationName",
        dd.code as "destinationCode",
        ta.trip_id as "tripId"
      FROM task_assignments ta
      JOIN machines m ON ta.machine_id = m.id
      LEFT JOIN parcels p ON ta.parcel_id = p.id
      LEFT JOIN users u ON ta.assigned_user_id = u.id
      LEFT JOIN delivery_destinations dd ON ta.destination_id = dd.id
      WHERE ${where}
      ORDER BY ta.machine_id, ta.sequence_order ASC`,
    );

    // Plan C — for trucks, enrich each assignment with its trip iterations
    // (root + descendants by parent_trip_id). The admin TruckPlanBoard renders
    // these as a vertical stack under each truck card.
    if (machineType === 'truck') {
      const rows = result as unknown as Record<string, unknown>[];
      for (const row of rows) {
        const tripId = row.tripId as string | null;
        if (!tripId) {
          (row as Record<string, unknown>).iterations = [];
          continue;
        }
        const iter = await this.drizzleProvider.db.execute(sql`
          SELECT
            id,
            trip_number AS "tripNumber",
            status,
            iteration_index AS "iterationIndex",
            bale_count AS "baleCount",
            loading_completed_at AS "loadingCompletedAt",
            completed_at AS "completedAt"
          FROM trips
          WHERE (id = ${tripId}::uuid OR parent_trip_id = ${tripId}::uuid)
            AND deleted_at IS NULL
            ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
          ORDER BY iteration_index ASC
        `);
        (row as Record<string, unknown>).iterations = iter as unknown as Record<string, unknown>[];
      }
    }
    return result;
  }

  async findById(id: string, orgId?: string | null) {
    const conditions: ReturnType<typeof sql>[] = [sql`id = ${id}`, sql`deleted_at IS NULL`];
    if (orgId !== null && orgId !== undefined) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`SELECT * FROM task_assignments WHERE ${where} LIMIT 1`,
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
  private async nextSequenceOrder(assignmentDate: string, machineId: string): Promise<number> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT COALESCE(MAX(sequence_order), -1) + 1 AS n
      FROM task_assignments
      WHERE assignment_date = ${assignmentDate} AND machine_id = ${machineId}
    `);
    const rows = result as unknown as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  }

  async create(orgId: string | null, dto: Record<string, unknown>) {
    // task_assignments.organization_id is NOT NULL. A null org here means the
    // caller has no organization context — a super_admin (org-less by design) or
    // an account whose org could not be resolved. Without this guard the INSERT
    // fails with a raw Postgres NOT-NULL 500; reject with a clear, actionable
    // error instead. (Covers bulkCreate too — it loops through create().)
    if (orgId === null) {
      throw new BadRequestException({
        error: 'no_organization',
        message:
          'Nu poți crea sarcini fără o organizație. Autentifică-te ca admin sau dispecer al unei organizații (conturile super_admin nu sunt legate de o organizație).',
      });
    }
    const assignmentDate = dto.assignmentDate as string;
    const machineId = dto.machineId as string;

    if (orgId !== null) {
      const machineCheck = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM machines WHERE id = ${machineId}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `)) as unknown as { id: string }[];
      if (!machineCheck.length)
        throw new ForbiddenException('Machine not found in your organization');

      if (dto.parcelId) {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels WHERE id = ${dto.parcelId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new ForbiddenException('Parcel not found in your organization');
      }

      if (dto.assignedUserId) {
        const userCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users WHERE id = ${dto.assignedUserId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!userCheck.length)
          throw new ForbiddenException('Assigned user not found in your organization');
      }

      if (dto.destinationId) {
        const destCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM delivery_destinations WHERE id = ${dto.destinationId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!destCheck.length)
          throw new ForbiddenException('Destination not found in your organization');
      }

      if (dto.parentAssignmentId) {
        const parentCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM task_assignments WHERE id = ${dto.parentAssignmentId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parentCheck.length)
          throw new ForbiddenException('Parent assignment not found in your organization');
      }
    }

    const sequenceOrder = await this.nextSequenceOrder(assignmentDate, machineId);

    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO task_assignments (
        organization_id,
        assignment_date, machine_id, parcel_id, assigned_user_id,
        priority, sequence_order, status, parent_assignment_id,
        destination_id, estimated_start, estimated_end, notes
      ) VALUES (
        ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
        ${assignmentDate}, ${machineId}, ${dto.parcelId ?? null},
        ${dto.assignedUserId ?? null}, ${dto.priority ?? 'normal'},
        ${sequenceOrder}, ${dto.status ?? 'available'}::task_assignment_status,
        ${dto.parentAssignmentId ?? null},
        ${dto.destinationId ?? null},
        ${dto.estimatedStart ?? null}, ${dto.estimatedEnd ?? null},
        ${dto.notes ?? null}
      ) RETURNING *`,
    );

    const rows = result as unknown as {
      id: string;
      assigned_user_id: string | null;
      parcel_id: string | null;
    }[];
    const assignedUserId = rows[0]?.assigned_user_id;
    if (assignedUserId) {
      void this.sendAssignmentPush(assignedUserId, rows[0]?.parcel_id ?? null, rows[0]?.id);
    }

    // Try to materialize a Trip for truck tasks. No-op otherwise.
    const newId = rows[0]?.id;
    if (newId) {
      await this.autoUpsertTripSafe(newId);
    }

    return result;
  }

  private async sendAssignmentPush(
    userId: string,
    parcelId: string | null,
    assignmentId: string,
  ): Promise<void> {
    try {
      const locale = await this.notificationsService.localeForUser(userId);
      let parcelName = tServer(locale, 'push.common.newParcel');
      if (parcelId) {
        const parcelRows = (await this.drizzleProvider.db.execute(
          sql`SELECT name FROM parcels WHERE id = ${parcelId} LIMIT 1`,
        )) as unknown as { name: string }[];
        if (parcelRows[0]?.name) parcelName = parcelRows[0].name;
      }
      await this.notificationsService.sendPush(
        userId,
        'push.assignmentCreated',
        { parcelName },
        { type: 'assignment_created', assignmentId, parcelName },
      );
    } catch {
      // Best-effort
    }
  }

  async bulkCreate(orgId: string | null, dtos: Record<string, unknown>[]) {
    const results: unknown[] = [];
    for (const dto of dtos) {
      const result = await this.create(orgId, dto);
      results.push(result);
    }
    return results;
  }

  async update(id: string, orgId: string | null, dto: Record<string, unknown>) {
    const before = await this.findById(id, orgId);
    const prevStatus = typeof before.status === 'string' ? before.status : undefined;

    if (orgId !== null) {
      if (dto.machineId) {
        const machineCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM machines WHERE id = ${dto.machineId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!machineCheck.length)
          throw new ForbiddenException('Machine not found in your organization');
      }

      if (dto.parcelId) {
        const parcelCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM parcels WHERE id = ${dto.parcelId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parcelCheck.length)
          throw new ForbiddenException('Parcel not found in your organization');
      }

      if (dto.assignedUserId) {
        const userCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM users WHERE id = ${dto.assignedUserId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!userCheck.length)
          throw new ForbiddenException('Assigned user not found in your organization');
      }

      if (dto.destinationId) {
        const destCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM delivery_destinations WHERE id = ${dto.destinationId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!destCheck.length)
          throw new ForbiddenException('Destination not found in your organization');
      }

      if (dto.parentAssignmentId) {
        const parentCheck = (await this.drizzleProvider.db.execute(sql`
          SELECT id FROM task_assignments WHERE id = ${dto.parentAssignmentId as string}::uuid AND organization_id = ${orgId}::uuid AND deleted_at IS NULL LIMIT 1
        `)) as unknown as { id: string }[];
        if (!parentCheck.length)
          throw new ForbiddenException('Parent assignment not found in your organization');
      }
    }

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
          setClauses.push(sql`${sql.raw(column)} = ${dto[key] as string}::task_assignment_status`);
        } else {
          setClauses.push(
            sql`${sql.raw(column)} = ${dto[key] as string | number | boolean | null}`,
          );
        }
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id, orgId);
    }

    setClauses.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setClauses, sql`, `);

    const updateConditions: ReturnType<typeof sql>[] = [sql`id = ${id}`, sql`deleted_at IS NULL`];
    if (orgId !== null) {
      updateConditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const updateWhere = sql.join(updateConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET ${setClause} WHERE ${updateWhere} RETURNING *`,
    );

    if ('status' in dto && typeof dto.status === 'string' && prevStatus) {
      this.winston.log('flow', `Task assignment ${id} status ${prevStatus} → ${dto.status}`, {
        context: 'TaskAssignmentsService',
        assignmentId: id,
        fromStatus: prevStatus,
        toStatus: dto.status,
      });
    }

    // Re-sync trip whenever the wiring changes (truck, parent loader, or destination).
    if ('parentAssignmentId' in dto || 'destinationId' in dto || 'machineId' in dto) {
      await this.autoUpsertTripSafe(id);
    }

    return result;
  }

  /**
   * Operator-friendly variant of `updateStatus` that lets a non-admin caller
   * mark their own assignment as `in_progress`. Ownership = caller is the
   * `assigned_user_id` OR the user permanently linked to the task's machine
   * (`users.assigned_machine_id`). Throws otherwise.
   *
   * Idempotent: if the assignment is already `in_progress`, returns the row
   * unchanged. Refuses to act on `done` rows so operators can't accidentally
   * re-open completed work.
   */
  async startByOperator(id: string, callerId: string, orgId?: string | null) {
    const whereConditions: ReturnType<typeof sql>[] = [
      sql`ta.id = ${id}`,
      sql`ta.deleted_at IS NULL`,
    ];
    if (orgId !== null && orgId !== undefined) {
      whereConditions.push(sql`ta.organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(whereConditions, sql` AND `);

    const ownerRows = (await this.drizzleProvider.db.execute(
      sql`SELECT ta.id, ta.status, ta.machine_id, ta.assigned_user_id,
                 u.id AS machine_user_id
          FROM task_assignments ta
          LEFT JOIN users u ON u.assigned_machine_id = ta.machine_id
                            AND u.deleted_at IS NULL
          WHERE ${where}
          LIMIT 1`,
    )) as unknown as {
      id: string;
      status: string;
      machine_id: string | null;
      assigned_user_id: string | null;
      machine_user_id: string | null;
    }[];

    const row = ownerRows[0];
    if (!row) {
      throw new NotFoundException('Task assignment not found');
    }
    const isOwner = row.assigned_user_id === callerId || row.machine_user_id === callerId;
    if (!isOwner) {
      throw new BadRequestException('Nu poți porni o sarcină care nu îți este asignată.');
    }
    if (row.status === 'done') {
      throw new BadRequestException(
        'Sarcina este deja finalizată. Cere dispecerului să o redeschidă.',
      );
    }
    if (row.status === 'in_progress') {
      return this.findById(id, orgId);
    }
    return this.updateStatus(id, 'in_progress', orgId);
  }

  async updateStatus(id: string, status: string, orgId?: string | null) {
    const before = await this.findById(id, orgId);
    const prevStatus = typeof before.status === 'string' ? before.status : 'unknown';

    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${status}::task_assignment_status`,
      sql`updated_at = NOW()`,
    ];

    // Auto-set actual_start/actual_end timestamps
    if (status === 'in_progress') {
      setClauses.push(sql`actual_start = COALESCE(actual_start, NOW())`);
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

    const whereConditions: ReturnType<typeof sql>[] = [sql`id = ${id}`, sql`deleted_at IS NULL`];
    if (orgId !== null && orgId !== undefined) {
      whereConditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(whereConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET ${setClause} WHERE ${where} RETURNING *`,
    );

    // Cascade: if moving to available, also move children to available
    if (status === 'available') {
      await this.cascadeToAvailable(id, orgId);
    }

    this.winston.log('flow', `Task assignment ${id} updateStatus ${prevStatus} → ${status}`, {
      context: 'TaskAssignmentsService',
      assignmentId: id,
      fromStatus: prevStatus,
      toStatus: status,
    });

    return result;
  }

  private async cascadeToAvailable(parentId: string, orgId?: string | null) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`parent_assignment_id = ${parentId}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null && orgId !== undefined) {
      conditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(conditions, sql` AND `);
    const children = await this.drizzleProvider.db.execute(
      sql`SELECT id FROM task_assignments WHERE ${where}`,
    );
    const childRows = children as unknown as Record<string, unknown>[];
    for (const child of childRows) {
      await this.updateStatus(child.id as string, 'available', orgId);
    }
  }

  async autoCompletePastAssignments(orgId: string | null, beforeDate: string) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`assignment_date < ${beforeDate}`,
      sql`status = 'in_progress'::task_assignment_status`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments
          SET status = 'done'::task_assignment_status,
              actual_end = COALESCE(actual_end, NOW()),
              updated_at = NOW()
          WHERE ${where}
          RETURNING id`,
    );
    return result;
  }

  async softDelete(id: string, orgId: string | null) {
    await this.findById(id, orgId);
    // Cancel linked trip BEFORE soft-deleting: autoCancelForTruckTask reads trip_id from the row.
    await this.autoCancelTripSafe(id);
    const deleteConditions: ReturnType<typeof sql>[] = [sql`id = ${id}`];
    if (orgId !== null) {
      deleteConditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const deleteWhere = sql.join(deleteConditions, sql` AND `);
    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET deleted_at = NOW(), updated_at = NOW() WHERE ${deleteWhere} RETURNING *`,
    );
    return result;
  }
}

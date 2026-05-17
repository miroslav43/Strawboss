# Multi-Tenancy Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and high-severity security/correctness bugs found in the multi-tenancy audit: unauthorized cross-org data access, missing org stamps on INSERTs, and broken frontend guards.

**Architecture:** All fixes follow the same pattern already used throughout the codebase — a `conditions` array built from `ReturnType<typeof sql>[]`, with `orgId !== null` guards before pushing the `organization_id` filter, and `sql.join(conditions, sql\` AND \`)` for the final WHERE clause. No new abstractions.

**Tech Stack:** NestJS 11 + Drizzle ORM raw `sql` template, Next.js 15 App Router (React client components).

---

## File Map

| File | Issues fixed |
|---|---|
| `backend/service/src/auth/roles.guard.ts` | C1 |
| `backend/service/src/parcels/parcels.service.ts` | C2, C3 |
| `backend/service/src/parcels/parcels.controller.ts` | C2 |
| `backend/service/src/parcel-daily-status/parcel-daily-status.service.ts` | C3 |
| `backend/service/src/parcel-daily-status/parcel-daily-status.controller.ts` | C3 |
| `backend/service/src/notifications/notifications.service.ts` | C4, C5 |
| `backend/service/src/notifications/notifications.controller.ts` | C5 |
| `backend/service/src/sync/sync.service.ts` | C6 |
| `backend/service/src/task-assignments/task-assignments.service.ts` | H1, H2, H3 |
| `backend/service/src/task-assignments/task-assignments.controller.ts` | H1, H3 |
| `backend/service/src/documents/documents.service.ts` | H4 |
| `backend/service/src/documents/cmr/cmr.service.ts` | H4 |
| `backend/service/src/trips/trips.service.ts` | H5 |
| `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx` | H6 |

---

### Task 1: RolesGuard — super_admin bypass (C1)

**Context:** `RolesGuard.canActivate` at line 35 does a strict `requiredRoles.includes(user.role)` check. `super_admin` was never added to any existing `@Roles('admin')` guards, so every endpoint outside `/organizations` returns 403 for super_admin. One line fix before the includes check.

**Files:**
- Modify: `backend/service/src/auth/roles.guard.ts:35`

- [ ] **Step 1: Read the file to confirm the exact line**

  Open `backend/service/src/auth/roles.guard.ts`. Confirm line 35 is `if (!requiredRoles.includes(user.role)) {`.

- [ ] **Step 2: Insert the super_admin bypass**

  Replace lines 34–39 (the `if (!requiredRoles.includes...)` block):

  ```typescript
  // super_admin bypasses all role requirements
  if (user.role === UserRole.super_admin) {
    return true;
  }

  if (!requiredRoles.includes(user.role)) {
    throw new ForbiddenException(
      `Role '${user.role}' is not authorized. Required: ${requiredRoles.join(', ')}`,
    );
  }
  ```

- [ ] **Step 3: Verify typecheck passes**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/auth/roles.guard.ts
  git commit -m "fix(auth): super_admin role bypasses all RolesGuard checks"
  ```

---

### Task 2: ParcelsService — getBaleAvailability cross-org leak (C2)

**Context:** `GET /parcels/:id/bale-availability` calls `getBaleAvailability(id)` with no `organizationId`. Any authenticated user from any org can query bale production/load counts for any parcel UUID. Fix: verify parcel ownership via `findById` (which already applies the org filter) before running the aggregate queries. The controller must pass `user.organizationId`.

**Files:**
- Modify: `backend/service/src/parcels/parcels.service.ts:46-56`
- Modify: `backend/service/src/parcels/parcels.controller.ts:42-45`

- [ ] **Step 1: Update `getBaleAvailability` in the service**

  Replace the existing `getBaleAvailability` method (lines ~46–56):

  ```typescript
  async getBaleAvailability(id: string, orgId: string | null) {
    // Ownership check — throws NotFoundException if parcel doesn't exist or belongs to another org
    await this.findById(id, orgId);

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(bale_count) FROM bale_productions WHERE parcel_id = ${id} AND deleted_at IS NULL), 0) AS "produced",
        COALESCE((SELECT SUM(bale_count) FROM bale_loads WHERE parcel_id = ${id} AND deleted_at IS NULL), 0) AS "loaded"
    `);
    const rows = result as unknown as Array<{ produced: number; loaded: number }>;
    const { produced, loaded } = rows[0];
    const remaining = Number(produced) - Number(loaded);
    return { produced: Number(produced), loaded: Number(loaded), remaining };
  }
  ```

- [ ] **Step 2: Update the controller endpoint to pass `user.organizationId`**

  Replace the existing `getBaleAvailability` handler in `parcels.controller.ts`:

  ```typescript
  @Get(':id/bale-availability')
  getBaleAvailability(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.parcelsService.getBaleAvailability(id, user.organizationId);
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/parcels/parcels.service.ts \
          backend/service/src/parcels/parcels.controller.ts
  git commit -m "fix(parcels): scope bale-availability endpoint to caller's org"
  ```

---

### Task 3: ParcelsService + ParcelDailyStatusService — applyHarvestStatusFromDailyPlan no org guard (C3)

**Context:** `applyHarvestStatusFromDailyPlan(parcelId, isDone)` runs `UPDATE parcels WHERE id = ${parcelId}` with no org filter. It is called only from `ParcelDailyStatusService.upsert`, which in turn is called from the controller. The controller currently doesn't pass `user.organizationId` anywhere in this chain.

**Files:**
- Modify: `backend/service/src/parcels/parcels.service.ts:292-299`
- Modify: `backend/service/src/parcel-daily-status/parcel-daily-status.service.ts:30-59`
- Modify: `backend/service/src/parcel-daily-status/parcel-daily-status.controller.ts:29-36`

- [ ] **Step 1: Add `orgId` to `applyHarvestStatusFromDailyPlan`**

  Replace the method in `parcels.service.ts` (lines ~292–299):

  ```typescript
  async applyHarvestStatusFromDailyPlan(parcelId: string, isDone: boolean, orgId: string | null) {
    const status = isDone ? 'harvested' : 'to_harvest';
    const conditions: ReturnType<typeof sql>[] = [
      sql`id = ${parcelId}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);
    await this.drizzleProvider.db.execute(sql`
      UPDATE parcels
      SET harvest_status = ${status}::harvest_status, updated_at = NOW()
      WHERE ${where}
    `);
  }
  ```

- [ ] **Step 2: Thread `orgId` through `ParcelDailyStatusService.upsert`**

  Replace the `upsert` method signature and body in `parcel-daily-status.service.ts`:

  ```typescript
  async upsert(
    orgId: string | null,
    dto: {
      parcelId: string;
      statusDate: string;
      isDone: boolean;
      notes?: string | null;
    },
  ) {
    const result = await this.drizzleProvider.db.execute(
      sql`INSERT INTO parcel_daily_status (parcel_id, status_date, is_done, notes)
          VALUES (${dto.parcelId}, ${dto.statusDate}, ${dto.isDone}, ${dto.notes ?? null})
          ON CONFLICT (parcel_id, status_date)
          DO UPDATE SET
            is_done = ${dto.isDone},
            notes = ${dto.notes ?? null},
            updated_at = NOW()
          RETURNING
            id,
            parcel_id as "parcelId",
            status_date as "statusDate",
            is_done as "isDone",
            notes,
            created_at as "createdAt",
            updated_at as "updatedAt"`,
    );

    await this.parcelsService.applyHarvestStatusFromDailyPlan(
      dto.parcelId,
      dto.isDone,
      orgId,
    );

    return result;
  }
  ```

- [ ] **Step 3: Pass `user.organizationId` from the controller**

  Replace the `upsert` handler in `parcel-daily-status.controller.ts`. Add `@CurrentUser()` and `RequestUser` import:

  ```typescript
  import { CurrentUser } from '../auth/current-user.decorator';
  import type { RequestUser } from '../auth/auth.guard';
  ```

  Then the handler:

  ```typescript
  @Put()
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  upsert(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertParcelDailyStatusSchema))
    dto: { parcelId: string; statusDate: string; isDone: boolean; notes?: string | null },
  ) {
    return this.parcelDailyStatusService.upsert(user.organizationId, dto);
  }
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/service/src/parcels/parcels.service.ts \
          backend/service/src/parcel-daily-status/parcel-daily-status.service.ts \
          backend/service/src/parcel-daily-status/parcel-daily-status.controller.ts
  git commit -m "fix(parcels): scope harvest status update to caller's org"
  ```

---

### Task 4: NotificationsService — confirmParcelDone missing organization_id on bale_productions INSERT (C4)

**Context:** `confirmParcelDone` inserts into `bale_productions` without `organization_id`, which is `NOT NULL` in the DB — this crashes at runtime. The existing ownership check already fetches the `task_assignments` row; we just need to also select `organization_id` from that row and include it in the INSERT SELECT.

**Files:**
- Modify: `backend/service/src/notifications/notifications.service.ts:199-259`

- [ ] **Step 1: Add `organization_id` to the ownership check SELECT**

  In `confirmParcelDone`, replace the existing ownership check query (lines ~200–211) to also fetch `organization_id`:

  ```typescript
  const ownerCheck = await this.drizzleProvider.db.execute(sql`
    SELECT assigned_user_id, organization_id FROM task_assignments
    WHERE id = ${assignmentId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `);
  const rows = ownerCheck as unknown as { assigned_user_id: string | null; organization_id: string | null }[];
  if (rows.length === 0) {
    throw new ForbiddenException('Assignment not found');
  }
  if (callerUserId && rows[0].assigned_user_id && rows[0].assigned_user_id !== callerUserId) {
    throw new ForbiddenException('You do not own this assignment');
  }
  ```

- [ ] **Step 2: Include `organization_id` in the bale_productions INSERT**

  Replace the bale_productions INSERT (lines ~238–252) to include `organization_id` in both the column list and the SELECT:

  ```typescript
  if (baleCount != null && baleCount > 0) {
    await this.drizzleProvider.db.execute(sql`
      INSERT INTO bale_productions
        (parcel_id, baler_id, operator_id, production_date, bale_count, end_time, organization_id)
      SELECT
        ta.parcel_id,
        ta.machine_id,
        ta.assigned_user_id,
        CURRENT_DATE,
        ${baleCount},
        now(),
        ta.organization_id
      FROM task_assignments ta
      WHERE ta.id = ${assignmentId}::uuid
        AND ta.parcel_id IS NOT NULL
        AND ta.assigned_user_id IS NOT NULL
    `);

    this.winston.log('flow', `Bale production recorded via geofence confirm`, {
      context: 'NotificationsService',
      assignmentId,
      baleCount,
    });
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/notifications/notifications.service.ts
  git commit -m "fix(notifications): stamp organization_id on bale_productions insert from confirmParcelDone"
  ```

---

### Task 5: NotificationsService — broadcast cross-org (C5)

**Context:** `broadcast({ kind: 'role', ... })` and `broadcast({ kind: 'all' })` query users with no `organization_id` filter — an admin from Org A broadcasts to Org B's drivers. Fix: add `orgId: string | null` as the first parameter; apply org filter to the user lookup queries; update the controller to pass `user.organizationId`.

**Files:**
- Modify: `backend/service/src/notifications/notifications.service.ts:134-167`
- Modify: `backend/service/src/notifications/notifications.controller.ts:52-64`

- [ ] **Step 1: Update `broadcast` signature and add org-scoped queries**

  Replace the entire `broadcast` method:

  ```typescript
  async broadcast(
    orgId: string | null,
    target: { kind: 'all' } | { kind: 'role'; role: string } | { kind: 'user'; userId: string },
    title: string,
    body: string,
  ): Promise<void> {
    let userIds: string[];

    if (target.kind === 'user') {
      userIds = [target.userId];
    } else if (target.kind === 'role') {
      const conditions: ReturnType<typeof sql>[] = [
        sql`role = ${target.role}`,
        sql`deleted_at IS NULL`,
      ];
      if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
      const where = sql.join(conditions, sql` AND `);
      const rows = await this.drizzleProvider.db.execute(
        sql`SELECT id FROM users WHERE ${where}`,
      ) as unknown as { id: string }[];
      userIds = rows.map(r => r.id);
    } else {
      // kind: 'all' — scope to org's device tokens via user join
      if (orgId !== null) {
        const rows = await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT dpt.user_id::text AS id
          FROM device_push_tokens dpt
          JOIN users u ON u.id = dpt.user_id AND u.deleted_at IS NULL
          WHERE dpt.is_active = true
            AND u.organization_id = ${orgId}::uuid
        `) as unknown as { id: string }[];
        userIds = rows.map(r => r.id);
      } else {
        const rows = await this.drizzleProvider.db.execute(sql`
          SELECT DISTINCT user_id::text AS id FROM device_push_tokens WHERE is_active = true
        `) as unknown as { id: string }[];
        userIds = rows.map(r => r.id);
      }
    }

    await Promise.all(
      userIds.map(uid =>
        this.sendPush(uid, title, body, { type: 'broadcast' }).catch(() => {}),
      ),
    );

    this.winston.log('info', `Broadcast sent to ${userIds.length} user(s)`, {
      context: 'NotificationsService',
      targetKind: target.kind,
      userCount: userIds.length,
    });
  }
  ```

- [ ] **Step 2: Update the controller to pass `user.organizationId`**

  Replace the `broadcast` handler in `notifications.controller.ts`:

  ```typescript
  @Post('broadcast')
  @Roles('admin' as UserRole)
  async broadcast(
    @CurrentUser() user: RequestUser,
    @Body() body: unknown,
  ) {
    const parsed = broadcastNotificationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid broadcast payload');
    }
    const { target, title, body: msgBody } = parsed.data;
    await this.notificationsService.broadcast(user.organizationId, target, title, msgBody);
    return { ok: true };
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/notifications/notifications.service.ts \
          backend/service/src/notifications/notifications.controller.ts
  git commit -m "fix(notifications): scope broadcast to caller's organization"
  ```

---

### Task 6: SyncService — ownership guard silent-pass for non-existent records (C6)

**Context:** For `update` and `delete` sync mutations, the org ownership guard is:

```typescript
if (guardRows.length && guardRows[0].organization_id !== orgId) { throw ... }
```

When the record doesn't exist, `guardRows.length` is `0`, so the condition is `false` (guard passes silently). The mutation then runs against a non-existent record. Fix: invert to throw when the record is absent OR when org doesn't match.

The same pattern appears in two places in `sync.service.ts`: the `update` block (~line 228) and the `delete` block (~line 277).

**Files:**
- Modify: `backend/service/src/sync/sync.service.ts` (two guard blocks)

- [ ] **Step 1: Fix the `update` block org guard**

  Locate the update guard block (around lines 228–238) that reads:

  ```typescript
  if (guardRows.length && guardRows[0].organization_id !== orgId) {
    throw new BadRequestException(
      `Record ${mutation.recordId} does not belong to caller's organization`,
    );
  }
  ```

  Replace it with:

  ```typescript
  if (!guardRows.length || guardRows[0].organization_id !== orgId) {
    throw new BadRequestException(
      `Record ${mutation.recordId} does not belong to caller's organization`,
    );
  }
  ```

- [ ] **Step 2: Fix the `delete` block org guard (same pattern, ~lines 277–287)**

  Same replacement — find the identical `if (guardRows.length && ...)` block in the `delete` branch and apply the same fix:

  ```typescript
  if (!guardRows.length || guardRows[0].organization_id !== orgId) {
    throw new BadRequestException(
      `Record ${mutation.recordId} does not belong to caller's organization`,
    );
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/sync/sync.service.ts
  git commit -m "fix(sync): org ownership guard now rejects non-existent records instead of silently passing"
  ```

---

### Task 7: TaskAssignmentsService — updateStatus + startByOperator missing org guard (H1)

**Context:**
- `updateStatus(id, status)` calls `findById(id)` with no orgId and UPDATEs with no org filter — any admin/dispatcher can mutate any org's assignment by ID.
- `startByOperator(id, callerId)` fetches the row with no org filter — a driver from Org A who knows an Org B assignment UUID can call `/task-assignments/:id/start`.
- The controller's `PATCH :id/status` handler (line ~97) doesn't pass `user.organizationId`; the `POST :id/start` handler (line ~113) doesn't pass it either.
- `cascadeToAvailable` calls `updateStatus` internally after verifying the parent — passing no orgId there is acceptable (children are fetched by parentId and trust the parent was already verified).

**Files:**
- Modify: `backend/service/src/task-assignments/task-assignments.service.ts` (lines ~562–647)
- Modify: `backend/service/src/task-assignments/task-assignments.controller.ts` (lines ~91–115)

- [ ] **Step 1: Add `orgId` to `updateStatus`**

  Replace the `updateStatus` signature and the UPDATE query inside it. The full method (lines ~600–647) becomes:

  ```typescript
  async updateStatus(id: string, status: string, orgId?: string | null) {
    const before = await this.findById(id, orgId);
    const prevStatus =
      typeof before.status === 'string' ? before.status : 'unknown';

    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${status}::task_assignment_status`,
      sql`updated_at = NOW()`,
    ];

    if (status === 'in_progress') {
      setClauses.push(sql`actual_start = COALESCE(actual_start, NOW())`);
    } else if (status === 'done') {
      setClauses.push(sql`actual_end = NOW()`);
    } else if (status === 'available') {
      setClauses.push(sql`parcel_id = NULL`);
      setClauses.push(sql`parent_assignment_id = NULL`);
      setClauses.push(sql`actual_start = NULL`);
      setClauses.push(sql`actual_end = NULL`);
    }

    const setClause = sql.join(setClauses, sql`, `);

    const whereConditions: ReturnType<typeof sql>[] = [
      sql`id = ${id}`,
      sql`deleted_at IS NULL`,
    ];
    if (orgId !== null && orgId !== undefined) {
      whereConditions.push(sql`organization_id = ${orgId}::uuid`);
    }
    const where = sql.join(whereConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE task_assignments SET ${setClause} WHERE ${where} RETURNING *`,
    );

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
  ```

- [ ] **Step 2: Add `orgId` to `startByOperator`**

  Replace the `startByOperator` method (lines ~562–598). Add `orgId` to the WHERE clause of the initial SELECT, pass it through to `findById` and `updateStatus`:

  ```typescript
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
    const isOwner =
      row.assigned_user_id === callerId || row.machine_user_id === callerId;
    if (!isOwner) {
      throw new BadRequestException(
        'Nu poți porni o sarcină care nu îți este asignată.',
      );
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
  ```

- [ ] **Step 3: Update the controller to pass `user.organizationId`**

  In `task-assignments.controller.ts`, replace the two handlers:

  ```typescript
  @Patch(':id/status')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateAssignmentStatusSchema))
    dto: { status: string },
  ) {
    return this.taskAssignmentsService.updateStatus(id, dto.status, user.organizationId);
  }
  ```

  ```typescript
  @Post(':id/start')
  @Roles(
    'admin' as UserRole,
    'loader_operator' as UserRole,
    'baler_operator' as UserRole,
    'driver' as UserRole,
  )
  startByOperator(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.taskAssignmentsService.startByOperator(id, user.id, user.organizationId);
  }
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/service/src/task-assignments/task-assignments.service.ts \
          backend/service/src/task-assignments/task-assignments.controller.ts
  git commit -m "fix(task-assignments): scope updateStatus and startByOperator to caller's org"
  ```

---

### Task 8: TaskAssignmentsService — getDailyPlan exposes cross-org machines and parcel statuses (H2)

**Context:** `getDailyPlan` has three sub-queries without org filters:
1. `allMachines` — returns machines from every org, so "available machines" panel shows cross-org inventory.
2. `parcelStatuses` — reads `parcel_daily_status` (no `organization_id` column) without joining to `parcels` on org.
3. `parcelDayShells` — JOINs `parcels` but doesn't filter by `parcels.organization_id`.

**Files:**
- Modify: `backend/service/src/task-assignments/task-assignments.service.ts` (lines ~163–193)

- [ ] **Step 1: Fix `allMachines` query with org filter**

  Replace the `allMachines` query block (lines ~184–193):

  ```typescript
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
  ```

- [ ] **Step 2: Fix `parcelStatuses` query to filter by org via parcels JOIN**

  Replace the `parcelStatuses` query block (lines ~163–170) with an org-scoped version. When `orgId` is set, JOIN to `parcels` to filter; when null (super_admin), keep original behaviour:

  ```typescript
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
  ```

- [ ] **Step 3: Fix `parcelDayShells` query to filter by org**

  Replace the `parcelDayShells` query block (lines ~173–181):

  ```typescript
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
    JOIN parcels p ON p.id = pds.parcel_id AND ${shellWhere}`,
  );
  ```

  Wait — the WHERE condition can't be used in the JOIN ON with mixed table refs. Use a standard WHERE instead:

  ```typescript
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
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/service/src/task-assignments/task-assignments.service.ts
  git commit -m "fix(task-assignments): scope getDailyPlan machines and parcel status queries to caller's org"
  ```

---

### Task 9: TaskAssignmentsService — autoCompletePastAssignments bulk-updates across all orgs (H3)

**Context:** `autoCompletePastAssignments(beforeDate)` bulk-updates every `in_progress` assignment across all orgs with no org filter. The controller endpoint `POST /task-assignments/auto-complete` doesn't pass `user.organizationId` to the service.

**Files:**
- Modify: `backend/service/src/task-assignments/task-assignments.service.ts:661-673`
- Modify: `backend/service/src/task-assignments/task-assignments.controller.ts:127-133`

- [ ] **Step 1: Add `orgId` to `autoCompletePastAssignments`**

  Replace the method (lines ~661–673):

  ```typescript
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
  ```

- [ ] **Step 2: Pass `user.organizationId` from the controller**

  Replace the `autoComplete` handler in `task-assignments.controller.ts` (lines ~127–133):

  ```typescript
  @Post('auto-complete')
  @Roles('admin' as UserRole, 'dispatcher' as UserRole)
  autoComplete(
    @CurrentUser() user: RequestUser,
    @Body() dto: { beforeDate: string },
  ) {
    return this.taskAssignmentsService.autoCompletePastAssignments(
      user.organizationId,
      dto.beforeDate,
    );
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/task-assignments/task-assignments.service.ts \
          backend/service/src/task-assignments/task-assignments.controller.ts
  git commit -m "fix(task-assignments): scope auto-complete bulk update to caller's org"
  ```

---

### Task 10: DocumentsService — updateStatus has no org guard (H4)

**Context:** `updateStatus(id, status, fileUrl?)` runs `UPDATE documents WHERE id = ${id}` with no org filter. It is called internally by `CmrService.generateCmr`, which already has `orgId` available. Adding `orgId` here closes the gap — the CMR service just passes its `orgId` argument through.

**Files:**
- Modify: `backend/service/src/documents/documents.service.ts:76-98`
- Modify: `backend/service/src/documents/cmr/cmr.service.ts:157,182`

- [ ] **Step 1: Add `orgId` to `DocumentsService.updateStatus`**

  Replace the method signature and WHERE clause (lines ~76–98):

  ```typescript
  async updateStatus(
    id: string,
    orgId: string | null,
    status: string,
    fileUrl?: string | null,
  ) {
    const setClauses: ReturnType<typeof sql>[] = [
      sql`status = ${status}`,
      sql`updated_at = NOW()`,
    ];

    if (status === 'generated' || status === 'sent') {
      setClauses.push(sql`generated_at = NOW()`);
    }
    if (fileUrl !== undefined) {
      setClauses.push(sql`file_url = ${fileUrl}`);
    }

    const setClause = sql.join(setClauses, sql`, `);

    const whereConditions: ReturnType<typeof sql>[] = [sql`id = ${id}`];
    if (orgId !== null) whereConditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(whereConditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`UPDATE documents SET ${setClause} WHERE ${where} RETURNING *`,
    );
    return result;
  }
  ```

- [ ] **Step 2: Update both call sites in `CmrService.generateCmr`**

  In `cmr.service.ts`, replace the two `updateStatus` calls:

  Success case (line ~157):
  ```typescript
  await this.documentsService.updateStatus(
    docId,
    orgId,
    DocumentStatus.generated,
    fileUrl,
  );
  ```

  Failure case (line ~182):
  ```typescript
  await this.documentsService.updateStatus(docId, orgId, DocumentStatus.failed);
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/documents/documents.service.ts \
          backend/service/src/documents/cmr/cmr.service.ts
  git commit -m "fix(documents): scope updateStatus to org and update CmrService callers"
  ```

---

### Task 11: TripsService — generateTripNumber shared across all orgs (H5)

**Context:** `generateTripNumber()` counts ALL trips for the current day regardless of org — two orgs sharing `TR-20260511-001`, `TR-20260511-002`, etc. leaks operational volume and causes sequence gaps when orgs create trips concurrently. Fix: add `orgId` parameter; when set, count only this org's trips for today.

**Files:**
- Modify: `backend/service/src/trips/trips.service.ts` (private `generateTripNumber` + its only caller `create`)

- [ ] **Step 1: Add `orgId` parameter to `generateTripNumber`**

  Replace the private method (lines ~242–254):

  ```typescript
  private async generateTripNumber(orgId: string | null): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `TR-${dateStr}-`;

    const conditions: ReturnType<typeof sql>[] = [
      sql`trip_number LIKE ${prefix + '%'}`,
    ];
    if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
    const where = sql.join(conditions, sql` AND `);

    const result = await this.drizzleProvider.db.execute(
      sql`SELECT COUNT(*)::int AS count FROM trips WHERE ${where}`,
    );
    const rows = result as unknown as { count: number }[];
    const count = (rows[0]?.count ?? 0) + 1;
    const seq = String(count).padStart(3, '0');
    return `${prefix}${seq}`;
  }
  ```

- [ ] **Step 2: Pass `orgId` from `create`**

  In the `create` method (line ~213), update the call:

  ```typescript
  const tripNumber = await this.generateTripNumber(orgId);
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/backend typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add backend/service/src/trips/trips.service.ts
  git commit -m "fix(trips): generate trip numbers per-org to prevent cross-tenant sequence collisions"
  ```

---

### Task 12: Admin Web layout.tsx — users with no organization_slug bypass the guard (H6)

**Context:** In `[slug]/(dashboard)/layout.tsx`, the guard is:

```typescript
if (userSlug && userSlug !== params.slug) {
  router.replace(`/${userSlug}/`);
  return;
}
setReady(true);
```

If `userSlug` is falsy (token has no `organization_slug` — misconfigured user, or soft-deleted org), the `&&` short-circuits to false and the user falls through to `setReady(true)`, landing on whatever slug they typed without any org validation. This pattern appears **twice**: once in the `getSession().then(...)` handler and again in the `onAuthStateChange` listener.

**Files:**
- Modify: `apps/admin-web/src/app/[slug]/(dashboard)/layout.tsx:43-48`, `74-79`

- [ ] **Step 1: Fix the getSession handler guard**

  In the `getSession().then(...)` callback, replace lines ~42–48:

  ```typescript
  // Regular users: redirect to their own org if URL slug doesn't match
  const userSlug = appMeta.organization_slug;
  if (!userSlug) {
    router.replace('/login');
    return;
  }
  if (userSlug !== params.slug) {
    router.replace(`/${userSlug}/`);
    return;
  }

  setReady(true);
  ```

- [ ] **Step 2: Fix the onAuthStateChange handler guard (identical change)**

  In the `onAuthStateChange` callback, replace lines ~73–79 with the same logic:

  ```typescript
  // Regular users: redirect to their own org if URL slug doesn't match
  const userSlug = appMeta.organization_slug;
  if (!userSlug) {
    setReady(false);
    router.replace('/login');
    return;
  }
  if (userSlug !== params.slug) {
    router.replace(`/${userSlug}/`);
    return;
  }

  setReady(true);
  ```

  Note: `setReady(false)` is added before the login redirect in the `onAuthStateChange` handler since the user was previously authenticated — we want to unmount the dashboard UI before redirecting.

- [ ] **Step 3: Typecheck**

  ```bash
  cd /srv/apps/Strawboss && pnpm --filter @strawboss/admin-web typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/admin-web/src/app/\[slug\]/\(dashboard\)/layout.tsx
  git commit -m "fix(admin-web): redirect users with no org_slug to login instead of silently passing guard"
  ```

---

### Task 13: Final typecheck + build

**Context:** Verify the entire monorepo compiles cleanly after all 12 patches.

**Files:** none created/modified

- [ ] **Step 1: Full typecheck**

  ```bash
  cd /srv/apps/Strawboss && ./strawboss.sh typecheck all
  ```
  Expected output:
  ```
  ▶  types               pass
  ▶  validation          pass
  ▶  ui-tokens           pass
  ▶  domain              pass
  ▶  api                 pass
  ▶  backend             pass
  ▶  admin-web           pass
  ▶  mobile              pass
  ✓  All typechecks passed.
  ```

- [ ] **Step 2: Full build**

  ```bash
  ./strawboss.sh build all
  ```
  Expected: `✓  Build complete: all`

- [ ] **Step 3: If either fails, fix the error before continuing**

  Read the error output, identify which file/line, fix the type mismatch, re-run the specific typecheck.


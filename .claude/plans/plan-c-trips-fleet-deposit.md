# Plan C — Trip Multi-Iteration, Fleet Coordination, Deposit & Fuel

> **Owning agent:** backend-agent + mobile-agent + frontend-agent (parallel, but landed as a single PR)
> **Branch:** `feat/plan-c-trips-fleet`
> **Effort:** **L** (≈ 4–5 working days)
> **Dependencies:** Plan B must export `parcelsService.advanceHarvestOnLoadEvent()` before Plan C's trip
>   transitions are wired up. Plan A is independent except for the shared
>   `apps/mobile/app/(driver)/index.tsx` file, which both plans touch (see the **Coordination contracts**
>   section). All three plans share the migrations directory, but each plan owns a separate file
>   (`00042`, `00043`, `00044`).
> **Migration number:** `00043_trip_multi_iteration_and_presence.sql`
> **Doc updates required after merge:** `database.md`, `backend.md`, `mobile.md`, `sync-protocol.md`
>   (run `/strawboss-sync-docs`).

---

## 1 · Scope & Non-Goals

### In scope (the seven user-facing tasks)

| # | Task (tascuri.txt) | Summary |
|---|---|---|
| T4 | "Vezi în admin task-uri cine e conectat" | Online indicator for users on the admin tasks pages, with last-seen timestamp persisted to `users.last_seen_at` |
| T12 | "Cont depozit pe mobile" | New mobile role `depot_manager` with inventory + incoming trips view, offline-cacheable |
| T13 | "O cursă să se întâmple de mai multe ori" | Multi-trip course via `trips.parent_trip_id` + `iteration_index`; loader & truck counters; loader-recall flow |
| T14 | "Truck idle → alertă la admin" | BullMQ `truck-idle-check` job creates an alert when an idle truck is not recalled within X min |
| T15 | "Mai multe curse pe camion pe zi" | Multiple trip iterations rendered per truck row in the TruckPlanBoard |
| T17 | "Combustibil — doar litri + poză" | Reduce fuel flow to 2 steps (liters + photo); drop odometer + OCR pre-fill |

### Explicit non-goals
- We do **NOT** introduce a separate `trip_courses` table. The self-referential
  `parent_trip_id` + `iteration_index` on `trips` is sufficient and avoids a join everywhere
  the trip is loaded (see decision rationale in §5).
- We do **NOT** redesign the trip state machine. Multi-trip is an *orchestration*
  layer above the existing 10-state lifecycle — each iteration is a regular trip.
- We do **NOT** ship a real-time websocket presence channel. The decision in
  §11 is **server-side `users.last_seen_at` heartbeat** (with optional Realtime fan-out).
- We do **NOT** refactor `EnhancedDeliveryFlow` (Plan A scope, FM-1 territory) beyond
  what is needed for "create next iteration on complete".

---

## 2 · File Ownership Matrix

| Path | Owner | Note |
|---|---|---|
| `supabase/migrations/00043_trip_multi_iteration_and_presence.sql` | **Plan C** | full SQL in §5 |
| `packages/types/src/entities/trip.ts` | **Plan C** | add `parentTripId`, `iterationIndex` |
| `packages/types/src/entities/user.ts` | **Plan C** | add `lastSeenAt`, `isOnline?` derived |
| `packages/validation/src/schemas/profile.schema.ts` | **Plan C** | tolerate new optional `lastSeenAt` |
| `packages/validation/src/schemas/user.schema.ts` | **Plan C** | add `lastSeenAt` field to `userSchema` |
| `packages/validation/src/schemas/trip.schema.ts` | **Plan C** | new `nextIterationDtoSchema`, `loaderRecallResponseSchema` |
| `backend/service/src/trips/trips.service.ts` | **Plan C** | `createNextIteration`, modified `complete`, helper queries |
| `backend/service/src/trips/trips.controller.ts` | **Plan C** | `POST /trips/:id/next-iteration` |
| `backend/service/src/notifications/notifications.service.ts` | **Plan C** | adds `sendTruckUnloadedLoaderPrompt`, `sendTruckIdleAdminAlert` |
| `backend/service/src/notifications/notifications.controller.ts` | **Plan C** | `POST /notifications/loader-recall-response` |
| `backend/service/src/task-assignments/task-assignments.service.ts` | **Plan C** | multi-trip per truck listing |
| `backend/service/src/fuel-logs/fuel-logs.controller.ts` | **Plan C** | odometer optional |
| `backend/service/src/fuel-logs/fuel-logs.service.ts` | **Plan C** | accept NULL `odometer_km` |
| `backend/service/src/deposit-inventory/*` | **Plan C** | new module |
| `backend/service/src/jobs/job-scheduler.service.ts` | **Plan C** | register `truck-idle-check` repeating job |
| `backend/service/src/jobs/queues.ts` | **Plan C** | `QUEUE_TRUCK_IDLE_CHECK` |
| `backend/service/src/trips/truck-idle.processor.ts` | **Plan C** | new BullMQ processor |
| `backend/service/src/alerts/alerts.service.ts` | **Plan C** | `createTruckIdleAlert()` factory |
| `backend/service/src/profile/profile.controller.ts` | **Plan C** | adds `POST /profile/heartbeat` |
| `backend/service/src/profile/profile.service.ts` | **Plan C** | `touchLastSeen(userId)` |
| `backend/service/src/sync/sync.service.ts` | **Plan C** | add `parent_trip_id`, `iteration_index` to `ALLOWED_COLUMNS.trips` and PULL projection |
| `apps/admin-web/src/app/[slug]/(dashboard)/tasks/**` | **Plan C** | online indicator + multi-trip rows |
| `apps/admin-web/src/components/features/tasks/machine-plan/TruckPlanBoard.tsx` | **Plan C** | render multiple iterations per truck row |
| `apps/admin-web/src/components/features/tasks/daily-plan/*` | **Plan C** (display only) | add `<UserPresenceDot />` next to `assignedUserName` |
| `apps/admin-web/src/components/shared/UserPresenceDot.tsx` | **Plan C** | new shared component |
| `apps/admin-web/messages/{en,ro}.json` | **Plan C** | keys under `tasks.online.*`, `tasks.truck.iterations.*` |
| `apps/mobile/app/(deposit)/**` | **Plan C** | new role group |
| `apps/mobile/app/_layout.tsx` | **Plan C** (additive only) | add `depot_manager: '/(deposit)'` to `ROLE_ROUTES` |
| `apps/mobile/app/(driver)/index.tsx` | **Plan C** *(shared)* | edit only within marked region — see §4 |
| `apps/mobile/app/(loader)/index.tsx` | **Plan C** | recall-response card |
| `apps/mobile/app/(driver)/fuel.tsx` | **Plan C** | switch to compact flow |
| `apps/mobile/src/components/features/fuel/FuelEntryFlow.tsx` | **Plan C** | drop 3 steps; keep only `liters` → `meter-photo` → `confirm` |
| `apps/mobile/src/db/trips-repo.ts` | **Plan C** | extend schema with `parent_trip_id`, `iteration_index`, remaining-bales helper |
| `apps/mobile/src/db/migrations.ts` | **Plan C** | new local migration for the two columns + deposit cache table |
| `apps/mobile/src/hooks/useTruckRemainingBales.ts` | **Plan C** | new |
| `apps/mobile/src/hooks/useDepotInventory.ts` | **Plan C** | new |
| `apps/mobile/src/hooks/useLoaderRecallPrompt.ts` | **Plan C** | new |
| `apps/mobile/src/lib/heartbeat.ts` | **Plan C** | new — 30 s heartbeat ticker (replaces ad-hoc presence) |
| `packages/api/src/hooks/use-trips.ts` (or `index.ts`) | **Plan C** | `useNextTripIteration`, `useTruckIdleAlerts` if needed |

### Files Plan C MUST NOT touch (taken from the brief, repeated here for safety)
- `apps/admin-web/src/app/[slug]/(dashboard)/map/**` — Plan A
- `apps/admin-web/src/lib/realtime.tsx` — Plan A
- `apps/admin-web/src/components/map/**` — Plan A
- `apps/admin-web/src/app/[slug]/(dashboard)/{farms,deposits,reports}/**` — Plan A
- `apps/admin-web/src/app/[slug]/(dashboard)/parcels/**` — Plan B
- `apps/mobile/app/(baler)/**`, `app/baler-ops/**`, `app/(geofence-maker)/**`
- `apps/mobile/src/components/features/production/**`
- `apps/mobile/src/components/features/delivery/**` (only touch if multi-trip absolutely requires)
- `apps/mobile/src/hooks/useGeofenceNotifications.ts`, `GeofenceOverlay.tsx`
- `backend/service/src/geofence/**`
- `backend/service/src/parcels/**` — except *importing* one helper (see §4)
- `packages/types/src/entities/parcel.ts`, `packages/validation/src/schemas/parcel.schema.ts`
- `supabase/migrations/00042_*.sql` (Plan B) and `00044_*.sql` (Plan A)

---

## 3 · Coordination Contracts

### 3.1 Marker comment in the shared driver index (with Plan A)

`apps/mobile/app/(driver)/index.tsx` is touched by **both** Plan A (the open-Maps button) and Plan C (the bale-counter badge per iteration). To make the file mergeable without conflicts, both plans must respect this contract:

1. Plan A wraps its new JSX with the marker comment:
   ```tsx
   {/* @plan-a:open-maps-button @start */}
   <OpenMapsToLoaderButton ... />
   {/* @plan-a:open-maps-button @end */}
   ```
2. Plan C inserts the iteration counter inside the existing `renderItem`'s `<View style={styles.meta}>` block (between line 457 and 468 in the current file). The marker:
   ```tsx
   {/* @plan-c:iteration-counter @start */}
   {item.iteration_index && item.iteration_index > 1 ? (
     <View style={styles.iterationBadge}>
       <Text style={styles.iterationText}>Cursa {item.iteration_index}</Text>
     </View>
   ) : null}
   {/* @plan-c:iteration-counter @end */}
   ```
3. **Neither plan touches** the `ActiveTripCard` component, the `styles` block (other than appending one new style), or the imports section beyond what is strictly needed. If Plan A and Plan C both need to add a new style, they each prefix with their plan letter (`planAButton`, `planCBadge`) to avoid collisions.
4. `apps/mobile/app/_layout.tsx` — Plan C adds **one line** to `ROLE_ROUTES`:
   ```tsx
   const ROLE_ROUTES: Record<string, string> = {
     baler_operator: '/(baler)',
     loader_operator: '/(loader)',
     driver: '/(driver)',
     geofence_maker: '/(geofence-maker)',
     depot_manager: '/(deposit)',          // ← Plan C
   };
   ```
   Plan B (if it modifies this file at all) must do so in a different surface (e.g. an inline observer effect). No mass-rewrite of this file is allowed by any plan.

### 3.2 Parcel harvest progression hook (with Plan B)

Plan B exposes a single helper that mutates `parcels.harvest_status` based on loader/truck events:

```ts
// Plan B owns the file. Plan C only imports it.
import { ParcelsService } from '../parcels/parcels.service';
// Injected via Nest DI in TripsModule's providers:
constructor(private readonly parcelsService: ParcelsService, ...)

// Call signature:
await this.parcelsService.advanceHarvestOnLoadEvent(
  parcelId,
  'loading_started' | 'all_loaded' | 'all_delivered',
);
```

**When Plan C calls it:**

| Trip transition | Argument | Triggering condition |
|---|---|---|
| `startLoading()` (any iteration) | `'loading_started'` | Trip moves planned → loading **AND** parcel `harvest_status` is `harvested` or `null` |
| `registerLoad()` / `completeLoading()` | `'all_loaded'` | After insert, if remaining-bales on `source_parcel_id` is 0 |
| `complete()` (last iteration) | `'all_delivered'` | After update, if there are zero in-transit/loading trips on the same `source_parcel_id` |

If `parcelsService` (or the method) is not yet available at Plan C merge time, **wrap each call in a `try/catch` and log a warn**. Never block a trip transition.

### 3.3 Notifications module discipline (with Plan B)

Plan B adds two helpers (`sendBalerFieldEntryConfirm`, `sendBalerFieldExitProduction`).
Plan C adds **only**:

- `sendTruckUnloadedLoaderPrompt(loaderId: string, tripId: string, truckCode: string): Promise<void>`
- `sendTruckIdleAdminAlert(orgId: string, truckId: string, truckCode: string, lastSeenAt: string, idleMinutes: number): Promise<void>`

Each plan modifies the same `notifications.service.ts` file but at clearly delimited locations (end of class, with `// region: plan-c` JSDoc comments).

### 3.4 Sync contract

Plan C extends `ALLOWED_COLUMNS.trips` (in `backend/service/src/sync/sync.service.ts`) with **`parent_trip_id`** and **`iteration_index`**. The PULL projection (`PROJECTION_COLUMNS.trips`) must also include them so mobile clients receive these fields after each delta. Plan B never touches the trips entry.

---

## 4 · Migration — `supabase/migrations/00043_trip_multi_iteration_and_presence.sql`

Idempotent. Safe to re-run. Bumps `sync_version` on `trips` rows only when we add a column to a row that already exists.

```sql
-- 00043_trip_multi_iteration_and_presence.sql
-- Plan C — multi-iteration trips, loader recall, presence heartbeat,
--          truck-idle detection support, deposit inventory query support.
--
-- Idempotent: every DDL is guarded with IF NOT EXISTS or DO $$ EXCEPTION blocks.
-- RLS: no new tables (only columns + index changes), so existing trip/user policies
--      apply unchanged.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) users.last_seen_at — server-side presence heartbeat
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Partial index: only living users with a heartbeat (fast "online now" query)
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
  ON users (last_seen_at DESC)
  WHERE deleted_at IS NULL AND last_seen_at IS NOT NULL;

COMMENT ON COLUMN users.last_seen_at IS
  'Updated by POST /profile/heartbeat (mobile every 30 s). NULL = never connected.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2) trips multi-iteration columns
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN parent_trip_id UUID
    REFERENCES trips(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD COLUMN iteration_index INTEGER NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_trips_iteration_index_positive
    CHECK (iteration_index >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Same parcel + same parent ⇒ iteration_index must be unique. We use a
-- partial unique index so cancelled / deleted iterations don't block re-use.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_parent_iteration
  ON trips (parent_trip_id, iteration_index)
  WHERE deleted_at IS NULL AND parent_trip_id IS NOT NULL;

-- Fast "find the latest iteration for this parcel/truck" query.
CREATE INDEX IF NOT EXISTS idx_trips_parent_trip_id
  ON trips (parent_trip_id)
  WHERE deleted_at IS NULL;

-- Used by the truck-idle BullMQ job (find open trips per truck cheaply).
CREATE INDEX IF NOT EXISTS idx_trips_truck_status_open
  ON trips (truck_id, status)
  WHERE deleted_at IS NULL
    AND status IN ('planned', 'loading', 'loaded', 'in_transit', 'arrived', 'delivering');

COMMENT ON COLUMN trips.parent_trip_id IS
  'NULL = root trip of a course. Non-NULL = iteration N≥2 of the same course.';
COMMENT ON COLUMN trips.iteration_index IS
  'Position within the course, 1-based. 1 = first trip on the parcel; auto-incremented per parent_trip_id.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3) sync_version bump: existing trips (iteration_index defaulted to 1)
--    must be pulled by every mobile client so they see the new column.
--    We use the global sync trigger from 00040 — touching updated_at
--    is enough to increment sync_version (trigger handles it).
-- ──────────────────────────────────────────────────────────────────────────
UPDATE trips
   SET updated_at = NOW()
 WHERE deleted_at IS NULL
   AND parent_trip_id IS NULL
   AND iteration_index = 1;
-- This is a one-shot backfill — re-runs are no-ops because every row is
-- already iteration_index=1.

-- ──────────────────────────────────────────────────────────────────────────
-- 4) Helper view: trip_courses (read-only, no DDL guard needed for views)
--    Aggregates a course (root trip + its descendants) into one row with
--    counts. Used by admin dashboards and the deposit incoming list.
-- ──────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS trip_courses;
CREATE VIEW trip_courses AS
WITH RECURSIVE course_tree AS (
  -- roots
  SELECT
    id           AS course_root_id,
    id           AS trip_id,
    source_parcel_id,
    truck_id,
    iteration_index,
    status,
    bale_count,
    created_at,
    completed_at
  FROM trips
  WHERE parent_trip_id IS NULL
    AND deleted_at IS NULL
  UNION ALL
  SELECT
    ct.course_root_id,
    t.id,
    t.source_parcel_id,
    t.truck_id,
    t.iteration_index,
    t.status,
    t.bale_count,
    t.created_at,
    t.completed_at
  FROM trips t
  JOIN course_tree ct ON t.parent_trip_id = ct.trip_id
  WHERE t.deleted_at IS NULL
)
SELECT
  course_root_id,
  COUNT(*)                                                     AS iteration_count,
  MAX(iteration_index)                                         AS last_iteration_index,
  SUM(CASE WHEN status = 'completed' THEN bale_count ELSE 0 END) AS total_delivered_bales,
  BOOL_OR(status IN ('loaded','in_transit','arrived','delivering','delivered','loading','planned'))
                                                                AS has_open_iteration,
  MIN(created_at)                                              AS started_at,
  MAX(completed_at)                                            AS last_completed_at
FROM course_tree
GROUP BY course_root_id;

COMMENT ON VIEW trip_courses IS
  'Plan C — aggregates a multi-iteration trip course into a single row. Read-only.';

-- ──────────────────────────────────────────────────────────────────────────
-- 5) RLS: no new tables. We deliberately do NOT add new policies — the
--    existing per-row trip / user policies (loader_operator sees their own,
--    driver sees their own, admin sees the org) cover parent_trip_id and
--    iteration_index transparently since they are columns on `trips`/`users`,
--    not separate tables.
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- 6) Optional: depot_manager role enum value
--    Adding it here means we don't need a separate migration just for
--    the deposit account in Plan C. Idempotent via ADD VALUE IF NOT EXISTS.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'depot_manager';

COMMIT;
```

> **Why no `trip_courses` table?** A self-reference on `trips` keeps every iteration
> queryable with the existing endpoints/repos and avoids a JOIN on every read. The
> recursive view above is enough for aggregate queries. We pay the cost of a recursive
> CTE only on the rare aggregate read; the common case (load N iterations for one truck)
> is a single index scan on `parent_trip_id`.

---

## 5 · Type & Validation Changes

### 5.1 `packages/types/src/entities/trip.ts`

```diff
 export interface Trip extends Timestamps, SoftDelete {
   id: string;
   tripNumber: string;
   status: TripStatus;
   sourceParcelId: string;
   sourceParcelAuto: boolean;
   loaderId: string | null;
   truckId: string;
   loaderOperatorId: string | null;
   driverId: string;
   baleCount: number;
+  /** Plan C — NULL for the root iteration, non-null for iteration N≥2. */
+  parentTripId: string | null;
+  /** Plan C — 1-based position inside the course. Always 1 for legacy rows. */
+  iterationIndex: number;
   loadingStartedAt: string | null;
   ...
 }
```

### 5.2 `packages/types/src/entities/user.ts`

```diff
 export interface User extends Timestamps, SoftDelete {
   id: string;
   email: string;
   ...
   lastLoginAt: string | null;
+  /** Plan C — heartbeat timestamp updated by POST /profile/heartbeat (mobile, 30s). */
+  lastSeenAt: string | null;
+  /** Derived in API layer (`isOnline = lastSeenAt within ONLINE_WINDOW_S`). Not stored. */
+  isOnline?: boolean;
   assignedMachineId: string | null;
   ...
 }
```

`UserRole` enum gets a new value:

```diff
 export enum UserRole {
   super_admin = 'super_admin',
   admin = 'admin',
   ...
   geofence_maker = 'geofence_maker',
+  depot_manager = 'depot_manager',
 }
```

### 5.3 `packages/validation/src/schemas/user.schema.ts`

Add `lastSeenAt: isoDateSchema.nullable().optional()` to the `userSchema` object (same place as `lastLoginAt`). Also append `'depot_manager'` to `adminAssignableRoleSchema`.

### 5.4 `packages/validation/src/schemas/trip.schema.ts`

```ts
export const nextIterationDtoSchema = z.object({
  recall: z.boolean(),
  // Optional explicit override — defaults to the current truck.
  truckId: z.string().uuid().optional(),
});

export const loaderRecallResponseSchema = z.object({
  tripId: z.string().uuid(),
  recall: z.boolean(),
});

// also: extend the existing tripSchema with the two new optional fields
export const tripSchema = z.object({
  // ... existing ...
  parentTripId: z.string().uuid().nullable(),
  iterationIndex: z.number().int().min(1),
});
```

### 5.5 `packages/validation/src/schemas/profile.schema.ts`

Add `heartbeatRequestSchema` — empty object (heartbeat takes no body):

```ts
export const heartbeatRequestSchema = z.object({}).strict();
```

---

## 6 · Backend Changes (per file)

### 6.1 `backend/service/src/trips/trips.service.ts`

#### New: `createNextIteration(currentTripId, callerId, orgId, recall: boolean)`

```ts
/**
 * Create the next iteration of a multi-trip course.
 *
 * - Same source_parcel_id, same truck/driver, same loader/loader_operator,
 *   same destination (denormalized fields).
 * - parent_trip_id = root of the current course (recursively); iteration_index
 *   = next available index for that root.
 * - status = 'planned'.
 *
 * Idempotency: serializes per course with `pg_advisory_xact_lock(hashtext('iter:' || rootId))`.
 *
 * If `recall = false`, only creates the row but DOES NOT push to driver
 * — used when the loader declines. (The truck becomes idle and the
 * idle-detection job will alert admin if needed.)
 */
async createNextIteration(
  currentTripId: string,
  orgId: string | null,
  recall: boolean,
): Promise<Record<string, unknown>> {
  return this.drizzleProvider.db.transaction(async (tx) => {
    // 1. Load current trip; find course root.
    const cur = (await tx.execute(sql`
      SELECT id, parent_trip_id, source_parcel_id, truck_id, driver_id,
             loader_id, loader_operator_id, destination_name, destination_address,
             ST_AsGeoJSON(destination_coords) AS destination_coords_geojson,
             organization_id
        FROM trips WHERE id = ${currentTripId} AND deleted_at IS NULL
        FOR UPDATE
    `)) as unknown as Record<string, unknown>[];
    if (!cur[0]) throw new NotFoundException('Trip not found');
    const t = cur[0];
    const rootId = (t.parent_trip_id as string | null) ?? (t.id as string);

    // Per-course lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('iter:' || ${rootId}))`);

    // 2. Compute next iteration_index.
    const next = (await tx.execute(sql`
      SELECT COALESCE(MAX(iteration_index), 0) + 1 AS n
        FROM trips
       WHERE (id = ${rootId} OR parent_trip_id = ${rootId})
         AND deleted_at IS NULL
    `)) as unknown as { n: number }[];
    const iterationIndex = Number(next[0]?.n ?? 2);

    // 3. Check remaining bales on the parcel.
    const remaining = await this.computeRemainingBalesOnParcel(
      t.source_parcel_id as string, orgId, tx,
    );
    if (remaining <= 0) {
      throw new BadRequestException({
        error: 'parcel_fully_loaded',
        message: 'Pe parcelă nu mai sunt baloți pentru o cursă nouă.',
      });
    }

    // 4. Insert the new trip — duplicates denormalized destination from previous iteration.
    const tripNumber = await this.generateTripNumber(orgId, tx);
    const inserted = (await tx.execute(sql`
      INSERT INTO trips (
        organization_id, trip_number, status,
        source_parcel_id, source_parcel_auto,
        truck_id, driver_id,
        loader_id, loader_operator_id,
        destination_name, destination_address,
        destination_coords,
        bale_count,
        parent_trip_id, iteration_index
      ) VALUES (
        ${orgId ? sql`${orgId}::uuid` : sql`NULL`},
        ${tripNumber}, ${TripStatus.planned}::trip_status,
        ${t.source_parcel_id}, true,
        ${t.truck_id}, ${t.driver_id},
        ${t.loader_id}, ${t.loader_operator_id},
        ${t.destination_name}, ${t.destination_address},
        ${t.destination_coords_geojson
            ? sql`ST_GeomFromGeoJSON(${t.destination_coords_geojson as string})`
            : sql`NULL`},
        0,
        ${rootId}, ${iterationIndex}
      )
      RETURNING *
    `)) as unknown as Record<string, unknown>[];
    const newTrip = inserted[0];

    this.logTripFlow(
      newTrip.id as string,
      'NEXT_ITERATION',
      'new',
      TripStatus.planned,
    );
    this.winston.log('flow', `Course ${rootId}: new iteration ${iterationIndex}`, {
      context: 'TripsService', rootId, iterationIndex, recall,
    });

    if (recall) {
      void this.pushToDriver(
        newTrip.id as string,
        'Cursă nouă',
        `Loaderul te cheamă înapoi — cursa ${iterationIndex}.`,
        'trip_next_iteration',
      );
    }
    return newTrip;
  });
}
```

#### Helper: `computeRemainingBalesOnParcel(parcelId, orgId, tx?)`

```ts
private async computeRemainingBalesOnParcel(
  parcelId: string,
  orgId: string | null,
  executor?: typeof this.drizzleProvider.db,
): Promise<number> {
  const db = executor ?? this.drizzleProvider.db;
  const rows = (await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(bale_count) FROM bale_productions
                WHERE parcel_id = ${parcelId} AND deleted_at IS NULL
                  ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS produced,
      COALESCE((SELECT SUM(bale_count) FROM bale_loads
                WHERE parcel_id = ${parcelId} AND deleted_at IS NULL
                  ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}), 0)::int AS loaded
  `)) as unknown as { produced: number; loaded: number }[];
  return Math.max(0, Number(rows[0]?.produced ?? 0) - Number(rows[0]?.loaded ?? 0));
}
```

#### Modified: `complete()` (existing line ~836)

After the existing `UPDATE trips SET status = completed ...` block, add:

```ts
// Plan C — multi-iteration hook.
// 1. Notify loader: "truck unloaded — recall?"
// 2. If remaining bales > 0, mark trip as "awaiting recall" via push.
// 3. Plan B contract — advance parcel harvest status if there are no
//    in-transit trips left on this parcel.
const sourceParcelId = trip.source_parcel_id as string | null;
const loaderOperatorId = trip.loader_operator_id as string | null;
if (sourceParcelId && loaderOperatorId) {
  const remaining = await this.computeRemainingBalesOnParcel(sourceParcelId, orgId);
  if (remaining > 0) {
    void this.notificationsService.sendTruckUnloadedLoaderPrompt(
      loaderOperatorId,
      id,
      String(trip.truck_code ?? trip.truck_plate ?? '—'),
    );
  } else {
    // No bales left → end of course, advance parcel harvest.
    try {
      await this.parcelsService.advanceHarvestOnLoadEvent(sourceParcelId, 'all_delivered');
    } catch (err) {
      this.winston.warn('parcelsService.advanceHarvestOnLoadEvent failed', {
        context: 'TripsService', parcelId: sourceParcelId, err,
      });
    }
  }
}
```

#### Modified: `startLoading()`

Add (after the successful UPDATE):

```ts
try {
  await this.parcelsService.advanceHarvestOnLoadEvent(
    trip.source_parcel_id as string, 'loading_started',
  );
} catch (err) {
  this.winston.warn('parcelsService.advanceHarvestOnLoadEvent (loading_started) failed', {
    context: 'TripsService', err,
  });
}
```

#### Modified: `registerLoad()` & `completeLoading()`

After the INSERT/UPDATE that finalizes the load, compute `remaining`. If it hits 0, call `parcelsService.advanceHarvestOnLoadEvent(..., 'all_loaded')`.

### 6.2 `backend/service/src/trips/trips.controller.ts`

Add:

```ts
import { nextIterationDtoSchema } from '@strawboss/validation';

@Post(':id/next-iteration')
@Roles('admin' as UserRole, 'loader_operator' as UserRole)
nextIteration(
  @Param('id') id: string,
  @CurrentUser() user: RequestUser,
  @Body(new ZodValidationPipe(nextIterationDtoSchema)) dto: { recall: boolean },
) {
  return this.tripsService.createNextIteration(id, user.organizationId, dto.recall);
}
```

### 6.3 `backend/service/src/notifications/notifications.service.ts`

Append (inside the class, after `confirmParcelDone()`):

```ts
// region: plan-c =========================================================

/**
 * After a truck unloads, prompt the loader: "Recall this truck for another run?"
 * Notification carries the tripId so the mobile client can wire the response
 * into POST /notifications/loader-recall-response.
 */
async sendTruckUnloadedLoaderPrompt(
  loaderId: string,
  tripId: string,
  truckCode: string,
): Promise<void> {
  await this.sendPush(
    loaderId,
    'Camion descărcat',
    `Camionul ${truckCode} a descărcat. Îl chemi înapoi?`,
    {
      type: 'loader_recall_prompt',
      tripId,
      truckCode,
      actions: ['recall_yes', 'recall_no'],
    },
  );
}

/**
 * After an idle truck has been idle for >= IDLE_THRESHOLD_MIN without
 * being recalled, notify all admins / dispatchers in the org.
 */
async sendTruckIdleAdminAlert(
  orgId: string | null,
  truckId: string,
  truckCode: string,
  lastSeenAt: string,
  idleMinutes: number,
): Promise<void> {
  // Fan out to every admin & dispatcher in the org.
  const conditions: ReturnType<typeof sql>[] = [
    sql`role IN ('admin'::user_role, 'dispatcher'::user_role)`,
    sql`deleted_at IS NULL`,
  ];
  if (orgId !== null) conditions.push(sql`organization_id = ${orgId}::uuid`);
  const where = sql.join(conditions, sql` AND `);
  const rows = (await this.drizzleProvider.db.execute(
    sql`SELECT id FROM users WHERE ${where}`,
  )) as unknown as { id: string }[];

  const title = 'Camion inactiv';
  const body = `Camionul ${truckCode} stă neutilizat de ${idleMinutes} min.`;
  await Promise.all(rows.map((r) =>
    this.sendPush(r.id, title, body, {
      type: 'truck_idle',
      truckId,
      truckCode,
      lastSeenAt,
      idleMinutes,
    }).catch(() => {}),
  ));
}
// endregion: plan-c ======================================================
```

### 6.4 `backend/service/src/notifications/notifications.controller.ts`

Add:

```ts
import { loaderRecallResponseSchema } from '@strawboss/validation';

@Post('loader-recall-response')
@Roles('loader_operator' as UserRole, 'admin' as UserRole)
async loaderRecallResponse(
  @CurrentUser() user: RequestUser,
  @Body(new ZodValidationPipe(loaderRecallResponseSchema))
  body: { tripId: string; recall: boolean },
) {
  // Delegate to TripsService for the actual "create next iteration" logic.
  if (body.recall) {
    await this.tripsService.createNextIteration(
      body.tripId, user.organizationId, /* recall */ true,
    );
  } else {
    // Record a "no recall" decision on the trip's metadata for the
    // truck-idle detector to use.
    await this.tripsService.recordNoRecall(body.tripId, user.organizationId, user.id);
  }
  return { ok: true };
}
```

(Inject `TripsService` into the controller's constructor — same pattern as `confirmParcelDone`.)

Add a tiny helper on `TripsService`:

```ts
async recordNoRecall(tripId: string, orgId: string | null, loaderId: string): Promise<void> {
  await this.drizzleProvider.db.execute(sql`
    UPDATE trips
       SET delivery_notes = COALESCE(delivery_notes, '')
                          || E'\n[recall_no:' || ${loaderId} || ':' || NOW() || ']',
           updated_at = NOW()
     WHERE id = ${tripId}
       ${orgId !== null ? sql`AND organization_id = ${orgId}::uuid` : sql``}
  `);
  this.logTripFlow(tripId, 'RECALL_NO', 'completed', 'completed');
}
```

### 6.5 `backend/service/src/task-assignments/task-assignments.service.ts`

Currently `getDailyPlan` / `getByMachineType` returns one row per truck assignment, but the UI assumes one trip slot per truck. The fix: don't change the assignment shape, instead JOIN the iterations in. Add:

```ts
/**
 * Plan C — returns assignments for trucks with their iterations grouped under
 * the truck assignment. Each iteration is a row from `trips` linked via
 * task_assignments.trip_id (root iteration) and trips.parent_trip_id chain.
 */
async getTruckPlanWithIterations(orgId: string | null, date: string) {
  const conditions: ReturnType<typeof sql>[] = [
    sql`ta.assignment_date = ${date}`,
    sql`ta.deleted_at IS NULL`,
    sql`m.machine_type = 'truck'`,
  ];
  if (orgId !== null) conditions.push(sql`ta.organization_id = ${orgId}::uuid`);
  const where = sql.join(conditions, sql` AND `);

  const rows = (await this.drizzleProvider.db.execute(sql`
    SELECT
      ta.id, ta.machine_id, ta.trip_id, ta.parent_assignment_id, ta.destination_id,
      m.internal_code AS machine_code, m.registration_plate,
      -- Course aggregate (iteration count, total delivered)
      tc.iteration_count, tc.last_iteration_index, tc.total_delivered_bales,
      tc.has_open_iteration, tc.last_completed_at
    FROM task_assignments ta
    JOIN machines m ON m.id = ta.machine_id
    LEFT JOIN trip_courses tc ON tc.course_root_id = ta.trip_id
    WHERE ${where}
    ORDER BY ta.machine_id, ta.sequence_order ASC
  `)) as unknown as Record<string, unknown>[];

  // For each truck assignment with a trip, list its iterations.
  for (const row of rows) {
    if (!row.trip_id) { row.iterations = []; continue; }
    const iter = await this.drizzleProvider.db.execute(sql`
      SELECT id, trip_number, status, iteration_index, bale_count,
             loading_completed_at, completed_at
        FROM trips
       WHERE (id = ${row.trip_id} OR parent_trip_id = ${row.trip_id})
         AND deleted_at IS NULL
       ORDER BY iteration_index ASC
    `);
    row.iterations = iter as unknown as Record<string, unknown>[];
  }
  return rows;
}
```

Wire it into `task-assignments.controller.ts` as `GET /task-assignments/truck-plan/:date`.

### 6.6 `backend/service/src/fuel-logs/`

`fuel-logs.controller.ts` (DTO schema) and `fuel-logs.service.ts`: change `odometer_km` from required to nullable. Concretely, update the Zod schema used for `POST /fuel-logs`:

```diff
 export const fuelLogCreateSchema = z.object({
   machineId: z.string().uuid(),
   ...
-  odometerKm: z.number().positive(),
+  odometerKm: z.number().positive().nullable().optional(),
+  receiptPhotoUrl: z.string().url().nullable(),   // ← becomes the required audit
   ...
 });
```

Service: pass through `null` and don't fail.

### 6.7 `backend/service/src/deposit-inventory/` (new module)

```
deposit-inventory.module.ts
deposit-inventory.controller.ts
deposit-inventory.service.ts
```

Endpoint: `GET /deposit-inventory/:depotId` returns:

```jsonc
{
  "depot": { "id": "...", "name": "Depozit Central", ... },
  "inventory": {
    "totalBales": 1287,          // Σ completed deliveries' bale_count minus outbound
    "totalNetWeightKg": 322500,
    "lastUpdate": "2026-05-24T..."
  },
  "incoming": [
    {
      "tripId": "...", "tripNumber": "TR-...", "status": "in_transit",
      "truckPlate": "B-123-XYZ", "driverName": "...",
      "etaMinutes": 28, "baleCount": 33
    }
  ]
}
```

Service SQL — inventory:

```sql
SELECT
  COALESCE(SUM(t.bale_count) FILTER (WHERE t.status = 'completed'), 0)::int    AS total_bales,
  COALESCE(SUM(t.gross_weight_kg - t.tare_weight_kg)
              FILTER (WHERE t.status = 'completed'), 0)::int                    AS total_net_weight_kg,
  MAX(t.completed_at)                                                           AS last_update
FROM trips t
JOIN delivery_destinations dd
  ON ST_DWithin(t.destination_coords::geography, dd.coords::geography, 50)
   OR ST_Contains(dd.boundary, t.destination_coords)   -- depot polygon if available
WHERE dd.id = $1
  AND t.deleted_at IS NULL;
```

Service SQL — incoming:

```sql
SELECT t.id, t.trip_number, t.status, t.bale_count,
       m.registration_plate AS truck_plate, u.full_name AS driver_name,
       -- naive ETA: distance / 60 km/h
       (ST_DistanceSphere(t.destination_coords,
          (SELECT ST_MakePoint(lon, lat)::geography
             FROM machine_location_events mle
            WHERE mle.machine_id = t.truck_id
            ORDER BY captured_at DESC LIMIT 1)) / 1000.0 / 60.0 * 60)::int AS eta_minutes
  FROM trips t
  JOIN machines m ON m.id = t.truck_id
  LEFT JOIN users u ON u.id = t.driver_id
 WHERE t.status IN ('in_transit', 'arrived')
   AND t.deleted_at IS NULL
   AND ST_DWithin(t.destination_coords::geography,
       (SELECT coords FROM delivery_destinations WHERE id = $1)::geography, 5);
```

Auth: any authenticated user inside the org (admins + depot_managers).

### 6.8 `backend/service/src/profile/profile.controller.ts` & `profile.service.ts`

```ts
// controller
@Post('heartbeat')
async heartbeat(@CurrentUser() user: RequestUser) {
  await this.profileService.touchLastSeen(user.id);
  return { ok: true };
}

// service
async touchLastSeen(userId: string): Promise<void> {
  await this.drizzleProvider.db.execute(sql`
    UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}::uuid AND deleted_at IS NULL
  `);
}
```

### 6.9 `backend/service/src/jobs/queues.ts` + `job-scheduler.service.ts` + new processor

```ts
// queues.ts
export const QUEUE_TRUCK_IDLE_CHECK = 'truck-idle-check';

// job-scheduler.service.ts onModuleInit() — append:
await this.truckIdleQueue.upsertJobScheduler(
  'truck-idle-repeat',
  { every: 5 * 60_000 },                       // see §13 for decision (5m vs 15m)
  { name: 'check', data: {} },
);
```

#### New file: `backend/service/src/trips/truck-idle.processor.ts`

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { QUEUE_TRUCK_IDLE_CHECK } from '../jobs/queues';

const IDLE_THRESHOLD_MIN = Number(process.env.STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN ?? '30');

@Injectable()
@Processor(QUEUE_TRUCK_IDLE_CHECK)
export class TruckIdleProcessor extends WorkerHost {
  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly notificationsService: NotificationsService,
    private readonly alertsService: AlertsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: Logger,
  ) { super(); }

  async process(_job: Job): Promise<void> {
    // 1) Find trucks that completed a trip > IDLE_THRESHOLD_MIN ago AND have
    //    no open subsequent iteration AND have NOT received a recall_no
    //    decision (delivery_notes does not contain '[recall_no').
    const rows = (await this.drizzleProvider.db.execute(sql`
      WITH last_completed AS (
        SELECT DISTINCT ON (truck_id)
               truck_id, id AS trip_id, source_parcel_id, organization_id,
               completed_at, delivery_notes
          FROM trips
         WHERE status = 'completed'
           AND deleted_at IS NULL
         ORDER BY truck_id, completed_at DESC
      )
      SELECT lc.truck_id, lc.trip_id, lc.organization_id, lc.completed_at,
             m.internal_code AS truck_code,
             EXTRACT(EPOCH FROM (NOW() - lc.completed_at))/60 AS idle_minutes,
             -- has another open iteration on the same course?
             (SELECT COUNT(*) FROM trips t2
                WHERE t2.deleted_at IS NULL
                  AND (t2.parent_trip_id = lc.trip_id OR t2.id = lc.trip_id)
                  AND t2.status IN ('planned','loading','loaded','in_transit','arrived','delivering'))::int
                AS open_iterations,
             -- still bales left on parcel?
             COALESCE((SELECT SUM(bp.bale_count) FROM bale_productions bp
                        WHERE bp.parcel_id = lc.source_parcel_id AND bp.deleted_at IS NULL), 0)
              - COALESCE((SELECT SUM(bl.bale_count) FROM bale_loads bl
                          WHERE bl.parcel_id = lc.source_parcel_id AND bl.deleted_at IS NULL), 0)
                AS remaining_bales,
             lc.delivery_notes
        FROM last_completed lc
        JOIN machines m ON m.id = lc.truck_id
       WHERE lc.completed_at < NOW() - (${IDLE_THRESHOLD_MIN} || ' minutes')::interval
    `)) as unknown as {
      truck_id: string;  trip_id: string;  organization_id: string | null;
      completed_at: string;  truck_code: string;  idle_minutes: number;
      open_iterations: number;  remaining_bales: number;  delivery_notes: string | null;
    }[];

    for (const r of rows) {
      if (r.open_iterations > 0) continue;            // recall already in progress
      if (r.remaining_bales <= 0) continue;           // parcel done, not idle
      if ((r.delivery_notes ?? '').includes('[recall_no')) {
        // Loader said "no recall" — still alert admin if idle persists.
      }
      // Dedup: skip if there is already an unacknowledged truck_idle alert
      // for this truck within the last 60 min.
      const existing = (await this.drizzleProvider.db.execute(sql`
        SELECT id FROM alerts
         WHERE machine_id = ${r.truck_id}::uuid
           AND category = 'system'
           AND is_acknowledged = false
           AND created_at > NOW() - INTERVAL '60 minutes'
           AND data->>'kind' = 'truck_idle'
         LIMIT 1
      `)) as unknown as { id: string }[];
      if (existing[0]) continue;

      await this.alertsService.createTruckIdleAlert({
        truckId: r.truck_id,
        truckCode: r.truck_code,
        idleMinutes: Math.round(Number(r.idle_minutes)),
        completedAt: r.completed_at,
        orgId: r.organization_id,
      });
      await this.notificationsService.sendTruckIdleAdminAlert(
        r.organization_id,
        r.truck_id,
        r.truck_code,
        r.completed_at,
        Math.round(Number(r.idle_minutes)),
      );
      this.winston.log('flow', `Truck idle alert: ${r.truck_code} idle ${r.idle_minutes}m`, {
        context: 'TruckIdleProcessor',
        truckId: r.truck_id,
        idleMinutes: r.idle_minutes,
      });
    }
  }
}
```

### 6.10 `backend/service/src/alerts/alerts.service.ts`

Add:

```ts
async createTruckIdleAlert(args: {
  truckId: string; truckCode: string; idleMinutes: number;
  completedAt: string; orgId: string | null;
}) {
  await this.drizzleProvider.db.execute(sql`
    INSERT INTO alerts (
      category, severity, title, description,
      machine_id, data, is_acknowledged, organization_id
    ) VALUES (
      'system', 'medium',
      'Camion inactiv',
      'Camionul ' || ${args.truckCode} || ' stă inactiv de ' || ${args.idleMinutes} || ' min.',
      ${args.truckId}::uuid,
      jsonb_build_object('kind','truck_idle','idleMinutes',${args.idleMinutes},'completedAt',${args.completedAt}),
      false,
      ${args.orgId ? sql`${args.orgId}::uuid` : sql`NULL`}
    )
  `);
}
```

(No new enum value — uses existing `category=system`.)

### 6.11 `backend/service/src/sync/sync.service.ts`

Two edits inside the file:

```diff
 trips: new Set([
   'id',
   ...
   'loader_operator_id',
   'loading_started_at',
   'loading_completed_at',
   'client_id',
+  'parent_trip_id',
+  'iteration_index',
   'sync_version',
 ]),
```

And add the two columns to whatever PROJECTION list the file uses for the trip pull (search for `PROJECTION_COLUMNS.trips` or the inline SELECT on `trips` in the pull path).

---

## 7 · Admin Web Changes

### 7.1 `<UserPresenceDot />` shared component (NEW)

`apps/admin-web/src/components/shared/UserPresenceDot.tsx`:

```tsx
import { cn } from '@/lib/utils';

const ONLINE_WINDOW_MS = 90 * 1000;  // 30s heartbeat + 60s grace

export function UserPresenceDot({ lastSeenAt, className }: {
  lastSeenAt: string | null;
  className?: string;
}) {
  const isOnline = lastSeenAt
    ? Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS
    : false;
  return (
    <span
      title={
        lastSeenAt
          ? isOnline ? 'Online' : `Ultima activitate: ${new Date(lastSeenAt).toLocaleString('ro-RO')}`
          : 'Niciodată conectat'
      }
      className={cn(
        'inline-block h-2 w-2 rounded-full ring-1 ring-white',
        isOnline ? 'bg-green-500 animate-pulse' : 'bg-neutral-300',
        className,
      )}
    />
  );
}
```

### 7.2 Wire into tasks pages

- **`apps/admin-web/src/components/features/tasks/daily-plan/InProgressColumn.tsx`** &
  **`AvailableColumn.tsx`** & **`DoneColumn.tsx`**: where the assigned user name renders
  (search for `assignedUserName`), wrap as:
  ```tsx
  <span className="flex items-center gap-1.5">
    <UserPresenceDot lastSeenAt={row.assignedUserLastSeenAt ?? null} />
    {row.assignedUserName ?? '—'}
  </span>
  ```
- Backend `task-assignments` JOINs `u.last_seen_at AS "assignedUserLastSeenAt"` everywhere
  it currently joins `u.full_name`.

### 7.3 TruckPlanBoard — multi-trip per row

Currently `TruckPlanBoard.tsx` renders one card per truck assignment. Plan C extends each truck card to show a vertical stack of iteration badges (one per row in the `tc.iteration_count`):

```tsx
{/* Iteration list — Plan C */}
{(assignment.iterations ?? []).length > 0 && (
  <div className="border-t border-neutral-100 px-4 py-3 space-y-1.5">
    <p className="text-xs font-medium text-neutral-500">{t('tasks.truck.iterations.title')}</p>
    {assignment.iterations.map((it) => (
      <div key={it.id} className="flex items-center justify-between text-xs">
        <span className="font-mono text-neutral-600">
          #{it.iterationIndex} · {it.tripNumber}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold',
          STATUS_BADGE_CLASS[it.status])}>
          {t(`trips.status.${it.status}`)}
        </span>
      </div>
    ))}
  </div>
)}
```

### 7.4 i18n keys (`apps/admin-web/messages/{en,ro}.json`)

Append:

```jsonc
{
  "tasks": {
    "online": {
      "online": "Conectat",
      "offline": "Deconectat",
      "lastSeen": "Ultima activitate {when}",
      "neverSeen": "Niciodată conectat"
    },
    "truck": {
      "iterations": {
        "title": "Curse pe această parcelă",
        "iterationN": "Cursa {n}",
        "remaining": "{n} baloți rămași",
        "recallAwaiting": "Așteaptă confirmarea loaderului",
        "recallDeclined": "Loaderul nu a chemat înapoi",
        "idleAlert": "Camion inactiv de {min} min"
      }
    }
  }
}
```

(Mirror to `en.json` with English translations.)

---

## 8 · Mobile Changes

### 8.1 Driver — bale counter inside trip card (T13)

Insert inside the marker region described in §3.1. Pull `iteration_index` from the local SQLite trip row (already pulled via sync after §6.11). Show a small `Cursa N` badge next to the bale count.

### 8.2 Loader — recall response card (T13/T14)

`apps/mobile/app/(loader)/index.tsx`: new sticky card shown when the loader receives a push of type `loader_recall_prompt`. Card:

```
┌──────────────────────────────────────────┐
│  Camion descărcat                        │
│  Camionul B-123-XYZ a descărcat cursa.   │
│  Pe parcelă mai sunt 47 baloți.          │
│                                          │
│   [  Cheamă înapoi  ]  [  Nu chema  ]    │
└──────────────────────────────────────────┘
```

Backed by `useLoaderRecallPrompt()` which:

1. Reads the latest unread `loader_recall_prompt` push from local `notifications` table.
2. Provides `confirm()` / `decline()` → `POST /notifications/loader-recall-response`.
3. Dismisses on success and triggers `triggerSync()` to pull the new iteration trip.

### 8.3 Deposit role tab group (T12)

`apps/mobile/app/(deposit)/` new directory:

```
(deposit)/
├── _layout.tsx          # tab bar: Inventar | Curse | Profil
├── index.tsx            # inventory + incoming list
├── trips.tsx            # detailed incoming list with ETA
└── profile.tsx          # reuse ProfileScreen
```

`index.tsx` calls `useDepotInventory()`:

```ts
// apps/mobile/src/hooks/useDepotInventory.ts
export function useDepotInventory(depotId: string | null) {
  return useQuery({
    queryKey: ['deposit-inventory', depotId],
    enabled: !!depotId,
    queryFn: async () => mobileApiClient.get(`/api/v1/deposit-inventory/${depotId}`),
    staleTime: 60_000,
    // Offline: TanStack Query returns cached data when offline. We additionally
    // persist the last response to SQLite via the `deposit_inventory_cache`
    // local table (created in the local migration), so even a cold boot offline
    // shows yesterday's snapshot.
  });
}
```

Local SQLite migration (`apps/mobile/src/db/migrations.ts`) adds:

```sql
CREATE TABLE IF NOT EXISTS deposit_inventory_cache (
  depot_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

`useDepotInventory` reads/writes that table.

### 8.4 Fuel flow simplification (T17)

Rewrite `FuelEntryFlow.tsx` to a **2-step** flow:

```
FuelStep = 'liters' | 'meter-photo' | 'confirm';
```

- Step 1: NumericPad for liters.
- Step 2: `OcrPhotoCapture` in pure-photo mode (no OCR pre-fill).
- Step 3: small confirm card with `liters` + thumbnail.

Drop `odometer`, `odometer-photo`, `receipt` (receipt was always optional). The repo call sends `odometer_km: null`. The server now accepts that.

The driver fuel screen (`apps/mobile/app/(driver)/fuel.tsx`) doesn't need to change beyond removing the obsolete prop wiring.

### 8.5 Heartbeat ticker

`apps/mobile/src/lib/heartbeat.ts`:

```ts
let timer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat() {
  stopHeartbeat();
  // Fire once immediately so the indicator flips on within seconds.
  void mobileApiClient.post('/api/v1/profile/heartbeat', {}).catch(() => {});
  timer = setInterval(() => {
    void mobileApiClient.post('/api/v1/profile/heartbeat', {}).catch(() => {});
  }, 30_000);
}
export function stopHeartbeat() {
  if (timer) { clearInterval(timer); timer = null; }
}
```

Started/stopped in `_layout.tsx` when `isAuthenticated && profileReady && role` flips true/false. AppState change to `background` calls `stopHeartbeat` to save battery; `active` calls `startHeartbeat`.

---

## 9 · Per-Task Deep Dive

### T4 — Online presence on admin task pages

**Problem.** Admin sees a list of operators on the task boards but has no idea who is at their phone right now versus who left their app two days ago. Today this requires asking on the phone.

**Current state.**
- `users.last_login_at` exists but is set only at login (`backend/service/src/auth/*`).
- No mobile heartbeat. No browser presence channel.
- `apps/admin-web/src/components/features/tasks/daily-plan/InProgressColumn.tsx` displays `assignedUserName` as plain text (~line 60+).

**Target.** A tiny green/grey dot next to every operator's name on every tasks board; admin sees who's online in real time. Last-seen timestamp persists across restarts.

**Step-by-step.**
1. Migration `00043` adds `users.last_seen_at` + index.
2. Mobile `heartbeat.ts` POSTs every 30s.
3. Backend `POST /profile/heartbeat` updates the column.
4. Task assignment JOIN exposes `assignedUserLastSeenAt`.
5. `<UserPresenceDot />` shared component reads it.
6. Wire into 3 admin task pages.

**Edge cases.**
- Mobile in airplane mode → no heartbeat → dot greys out after ~90 s. Correct.
- Server clock drift → small (NTP); window of 90 s tolerates it.
- Two devices for one user (admin web + mobile) → either updates the field; OK.

**Acceptance.**
- Open the loaders tab while a loader_operator is in the app → green dot within 60 s.
- Force-quit the mobile app → dot turns grey within 90 s (no page reload required, polling every 30 s).

**Effort.** **S** — 1 mid-sized backend file, 1 small mobile lib, 1 React component, JOIN tweak.

---

### T12 — Deposit account on mobile

**Problem.** Depot operators have no mobile view of incoming bales or current stock.

**Current state.** No `depot_manager` role; no inventory endpoint; the depot lives only as a `delivery_destinations` row used by drivers.

**Target.** New role `depot_manager`. Logs in on mobile, lands on `(deposit)` tab group:
- **Inventar**: count of bales currently in stock + total net weight.
- **Curse**: list of incoming trips (in_transit/arrived) heading toward this depot, with ETA.
- Works offline (cached snapshot).

**Step-by-step.**
1. Migration adds `depot_manager` to `user_role` enum.
2. Backend new module `deposit-inventory`.
3. Mobile new `(deposit)` group + `ROLE_ROUTES` entry.
4. `useDepotInventory` hook with TanStack Query + SQLite write-through cache.
5. `_layout.tsx` does NOT need GPS background tracking for this role.

**Edge cases.**
- A depot_manager assigned to multiple depots → for v1, pick the first delivery_destination where `manager_user_id = $userId`. (Future: dropdown.) We add `delivery_destinations.manager_user_id UUID` if Plan A doesn't beat us to it. Otherwise resolve by query string in the URL.
- Offline first-boot with no cache → show "Sincronizează" CTA, no crash.

**Acceptance.**
- Login as a `depot_manager` → lands on `/(deposit)`. Sees inventory.
- Toggle airplane mode → still shows last fetched data.

**Effort.** **M** — full vertical slice but small surface (1 backend module, 1 mobile role group, 1 SQLite table).

---

### T13 — Multi-trip course with bale counter & loader recall

**Problem.** Each loaded truck creates one independent trip. To haul a full parcel you need N trips, but the system has no concept of "course = N trips on the same parcel". The loader has to manually create each one and the truck silently disappears after delivery.

**Current state.** Trip ER diagram has no `parent_trip_id`. The loader's UI (`(loader)/index.tsx`) lists trucks at the loader, not iterations remaining. The driver's UI (`(driver)/index.tsx`) shows trips flat.

**Target.**

```
Parcel "Câmpul 12"  ┐
                    ├──→ Trip iter#1 (root, parent_trip_id=NULL)  truck A
                    ├──→ Trip iter#2 (parent=iter#1)              truck A  ← created if recall=yes
                    └──→ Trip iter#3 (parent=iter#1)              truck A  ← repeat until remaining=0
```

- Loader card shows `Cursa N — X baloți rămași`.
- Driver card shows `Cursa N`.
- On `complete()`, server pushes `loader_recall_prompt` to loader.
- Loader taps Yes → `POST /notifications/loader-recall-response { recall: true }` → server creates next iteration → driver gets `trip_next_iteration` push.
- Loader taps No → server records `[recall_no:...]` in the parent trip's notes; truck becomes idle.
- When `remaining_bales = 0`, prompt is suppressed; course ends naturally.

**Step-by-step.**
1. Migration adds `parent_trip_id` + `iteration_index` + view.
2. Backend `createNextIteration()` + `complete()` hook + `/next-iteration` endpoint.
3. Backend `loader-recall-response` endpoint.
4. Sync exposes the two columns.
5. Mobile: loader recall card + driver iteration badge.
6. Plan B contract calls placed in `startLoading`, `registerLoad`, `complete`.

**Edge cases.**
- Two loaders racing to create iteration #2 → advisory lock `iter:<rootId>` serializes them.
- Recall accepted while the truck is still on the road → next-iteration trip is created in `planned`. Driver's existing trip is unaffected; once they complete it, they see the new planned one.
- Parcel has 0 bales remaining but loader still says "yes" → server returns 400 `parcel_fully_loaded`.
- Driver swap mid-course → admin can manually create a new iteration with a different `truckId`; the API supports `truckId` override in the DTO.

**Acceptance.**
- Run a 100-bale course with a 33-bale truck → 4 iterations auto-created; each one shows the correct iteration_index in admin TruckPlanBoard; loader sees recall prompt 3 times.
- After 4 iterations, no more prompts; parcel `harvest_status` advances (Plan B handles the final state).

**Effort.** **L** — biggest piece of Plan C (≈ 1.5 days).

---

### T14 — Idle-truck admin alert

**Problem.** If a loader keeps declining recall (or simply forgets), the truck sits at the depot doing nothing while bales rot on the parcel.

**Target.** Every 5 min, BullMQ scans trucks whose last `completed` trip is > 30 min old, no open iteration exists, parcel still has bales → create a `truck_idle` alert (category `system`) + push to all admins/dispatchers in the org.

**Current state.** No idle detection. `alerts` table exists with category=system available.

**Step-by-step.**
1. New queue `QUEUE_TRUCK_IDLE_CHECK` + scheduler entry.
2. New processor `truck-idle.processor.ts` (full SQL in §6.9).
3. `AlertsService.createTruckIdleAlert()` factory.
4. `NotificationsService.sendTruckIdleAdminAlert()` fans out push.
5. Dedup: skip if there's an unacknowledged `truck_idle` for this truck in the last 60 min.

**Edge cases.**
- Truck completes its trip and *is* recalled → an `iteration#N+1` exists in `planned/loading/loaded` → `open_iterations > 0` → no alert. Correct.
- Parcel is genuinely done → `remaining_bales <= 0` → no alert. Correct.
- Loader sent recall_no, parcel still has bales → IS idle → alert fires. (Operator chose to decline; admin should know.)
- Admin acknowledges → no new alert for 60 min; if still idle after, a fresh one fires.

**Acceptance.**
- Manually complete a trip, wait 31 min without recalling → an alert appears in `/alerts` and admins get a push notification.
- Acknowledge it → no second alert in the next hour even though truck is still idle.

**Effort.** **M** — single BullMQ processor + 2 helper methods.

---

### T15 — Multiple trips per truck per day in admin

**Problem.** `TruckPlanBoard.tsx` is built around one assignment per truck row; if you assign the same truck to two parcels in one day (which already works at the data layer), the UI doesn't show both.

**Current state.** `tasks/trucks/page.tsx` → `TruckPlanBoard`. The board uses `assignedTrucks` (one entry per `machineId`, dedup'd). The iteration data isn't shown at all.

**Target.** A truck card displays all course iterations for the day stacked vertically under the loader/deposit selectors. Multiple top-level assignments per truck (different parcels) appear as separate cards.

**Step-by-step.**
1. Backend `getTruckPlanWithIterations(date)` returns one row per assignment with an `iterations[]` array.
2. New `useTasksByMachineTypeWithIterations` hook in `@strawboss/api`.
3. `TruckPlanBoard` consumes it, renders iteration list (§7.3).
4. Remove the dedup in `assignedTrucks` — change to dedup on `assignment.id` instead of `machineId`, so the board shows two cards for one truck when it has two assignments.

**Edge cases.**
- Backwards-compat: trips without an `iteration_index` (rows from before migration) → backfill defaulted them to 1; no UI surprise.

**Acceptance.**
- Admin assigns truck T-001 to parcel A and parcel B → two cards on the board; each shows its own loader/deposit and its own iteration list.

**Effort.** **S** — backend query + UI render, ~half a day.

---

### T17 — Simplified fuel flow

**Problem.** Current `FuelEntryFlow` has 5 steps (receipt, liters, odometer-photo, odometer, confirm). OCR pre-fill is unreliable and the odometer is rarely useful for the field operator.

**Target.** 2 steps + confirm: liters + meter photo + confirm. Photo is the audit record. Odometer goes away from the form entirely (back-end accepts null).

**Step-by-step.**
1. Rewrite `FuelEntryFlow.tsx` (drop ~120 lines).
2. Mobile `fuel-logs-repo.ts` `create()` already accepts null odometer; no change needed.
3. Server `fuelLogCreateSchema` lets `odometerKm` be nullable; service inserts `NULL`.
4. Drop `kmSuggested`, `setKmSuggested`, all OCR pre-fill state.

**Edge cases.**
- Existing fuel logs with non-null odometers are untouched — reports still aggregate them.
- Reconciliation that depends on `odometer_distance_km` (generated column) — that column is on `trips`, not on `fuel_logs`, so unaffected.

**Acceptance.**
- Driver fuel screen now needs 2 taps after starting: enter liters → take photo → confirm.
- POST /fuel-logs returns 201 with `odometerKm: null` accepted.

**Effort.** **S** — pure simplification.

---

## 10 · Presence Implementation Deep Dive (T4)

### 10.1 Decision: server-side heartbeat (NOT Supabase Realtime presence)

**Decision: heartbeat to `POST /api/v1/profile/heartbeat` every 30 s, persisted in `users.last_seen_at`.**

**Justification (3 sentences):**
1. Supabase Realtime presence is a great fit for a browser-to-browser collab tool, but our presence consumer is the **admin web** while the presence emitter is the **mobile app** — different runtimes, different websocket lifecycles, and the mobile WebSocket would be killed by Android Doze every few minutes, producing false offlines.
2. A 30 s heartbeat against a single `UPDATE users SET last_seen_at = NOW()` is **~1 write/s per active user** total, trivial for Supabase Postgres and gives us a single source of truth that survives reconnect/crash and is queryable historically (which presence channels are not).
3. The cost of the chosen approach is one extra mobile HTTP call per 30 s (~50 bytes payload, ignored by the connection-status badge); the benefit is that the same `users.last_seen_at` column powers **offline-tolerant "last activity X min ago"** copies in admin AND becomes the trigger for future inactivity/safety features without any extra plumbing.

### 10.2 Why not both?

We can layer a Realtime fan-out **later** if admins want sub-second indicator updates: a Postgres trigger on `users.last_seen_at` UPDATE that fires `pg_notify('user_seen', user_id)` and `RealtimeProvider` invalidates the relevant query key. Out of scope for v1.

### 10.3 Concrete implementation

#### Mobile

`apps/mobile/src/lib/heartbeat.ts` (full source in §8.5).

Started in `apps/mobile/app/_layout.tsx`:

```diff
   useEffect(() => {
     if (!isAuthenticated || !profileReady || !role) return;
     void registerBackgroundSyncTask();
+    startHeartbeat();
     return () => {
       void unregisterBackgroundSyncTask();
+      stopHeartbeat();
     };
   }, [isAuthenticated, profileReady, role]);
```

Pause when app is backgrounded:

```ts
AppState.addEventListener('change', (s) => {
  if (s === 'background') stopHeartbeat();
  if (s === 'active' && useAuthStore.getState().role) startHeartbeat();
});
```

#### Backend

`profile.controller.ts`:

```ts
@Post('heartbeat')
async heartbeat(@CurrentUser() user: RequestUser) {
  await this.profileService.touchLastSeen(user.id);
  return { ok: true };
}
```

`profile.service.ts`:

```ts
async touchLastSeen(userId: string): Promise<void> {
  await this.drizzleProvider.db.execute(sql`
    UPDATE users
       SET last_seen_at = NOW()
     WHERE id = ${userId}::uuid AND deleted_at IS NULL
  `);
}
```

Rate-limited at nginx? Not necessary at 1 req / 30 s / user; we'll re-evaluate if a misconfigured client hits us at 1 Hz (cap to 1 update / 10 s if needed).

#### Web

`UserPresenceDot.tsx` (full source in §7.1). Refresh strategy: every 30 s `setInterval` to trigger a re-render so the "online window" check is current. Avoid creating one timer per dot — one global `useNow()` hook returning `Date.now()` updated every 30 s; all dots subscribe.

```ts
// apps/admin-web/src/hooks/useNow.ts
const subscribers = new Set<() => void>();
let now = Date.now();
setInterval(() => { now = Date.now(); subscribers.forEach((s) => s()); }, 30_000);
export function useNow() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { subscribers.add(force); return () => { subscribers.delete(force); }; }, []);
  return now;
}
```

---

## 11 · Cross-Cutting Concerns

### 11.1 BullMQ design for `truck-idle-check`

- **Interval.** **5 min** chosen over 15 min. Rationale: detection latency
  matters operationally (the loader's recall-no decision is final and the
  truck is wasting capacity). At 5 min, the worst-case alert latency = 5 m
  beyond the threshold; at 15 min, up to 20 m latency. Volume per cycle is
  tiny (LIMIT by org × trucks ≈ tens of rows).
- **Dedup.** The processor checks for an unacknowledged `truck_idle` alert
  with `data->>'kind' = 'truck_idle'` and `created_at > NOW() - 60m` before
  inserting. The 60 min window prevents pulsing.
- **Concurrency.** `concurrency: 1` on the worker (default) is fine; the SQL
  is one statement and `IDLE_THRESHOLD_MIN` is read once per run.

### 11.2 Offline behavior for deposit inventory

- Cache the latest `GET /deposit-inventory/:depotId` response into
  `deposit_inventory_cache` (one row per depot) on every successful fetch.
- On cold boot offline, `useDepotInventory` reads from the cache first and
  returns it as the initialData for TanStack Query.
- Surface a small "ultima sincronizare 14:32" timestamp under the card so the
  operator knows it isn't live.

### 11.3 Sync coverage

- After migration `00043`, every `trips` row's `sync_version` is bumped via
  the global trigger so the next mobile pull receives the new columns.
- The mobile `migrations.ts` adds two `ALTER TABLE trips ADD COLUMN
  parent_trip_id TEXT` / `iteration_index INTEGER DEFAULT 1` to local SQLite.
- `useTruckRemainingBales(parcelId)` (new mobile hook) computes
  `produced - loaded` from local SQLite (`bale_productions`, `bale_loads`),
  so the counter works offline.

### 11.4 i18n & copy

All copy is Romanian-first, English mirror. Specimen Romanian strings:

| Key | Romanian | Where |
|---|---|---|
| `tasks.online.online` | "Conectat" | tooltip |
| `tasks.online.lastSeen` | "Ultima activitate {when}" | tooltip |
| `tasks.truck.iterations.title` | "Curse pe această parcelă" | TruckPlanBoard |
| Push title | "Camion descărcat" | loader recall |
| Push body | "Camionul {truckCode} a descărcat. Îl chemi înapoi?" | loader recall |
| Push title | "Cursă nouă" | recalled iteration to driver |
| Push body | "Loaderul te cheamă înapoi — cursa {n}." | recalled iteration |
| Alert title | "Camion inactiv" | system alert |
| Alert body | "Camionul {truckCode} stă inactiv de {min} min." | system alert |

### 11.5 Logging

- Every `createNextIteration` logs `flow` with `{ rootId, iterationIndex, recall, parcelId }`.
- Every truck-idle alert logs `flow` with `{ truckId, idleMinutes }`.
- Heartbeat is logged at `debug` only (otherwise the file fills up).

---

## 12 · Verification Checklist

### 12.1 Static

- `pnpm --filter @strawboss/types typecheck`
- `pnpm --filter @strawboss/validation typecheck`
- `pnpm --filter @strawboss/backend typecheck`
- `pnpm --filter @strawboss/admin-web typecheck`
- `pnpm --filter @strawboss/mobile typecheck`
- `./strawboss.sh lint`

### 12.2 Migration

- `./strawboss.sh db:migrate` — apply `00043`.
- `psql ... -c "SELECT column_name FROM information_schema.columns WHERE table_name='trips' AND column_name IN ('parent_trip_id','iteration_index');"` returns 2 rows.
- Re-run `db:migrate` — exits 0 with no changes (idempotency check).

### 12.3 Multi-trip golden path (manual on staging)

1. Admin assigns truck T1 + loader L1 to parcel P (35 bales produced).
2. T1 capacity = 12.
3. Loader marks `Camion plin` 3× consecutively → 3 iterations created (35 → 23 → 11 → 0 bales remaining).
4. After iteration #1's `complete`, loader receives "Camion descărcat" push and taps "Da" → iteration #2 trip materializes within 2 s.
5. After iteration #3, no further prompt; admin board shows parcel `harvest_status = harvested`.

### 12.4 Idle alert trigger test

1. Complete a trip on parcel P (still has bales).
2. Loader taps "Nu chema".
3. Force the BullMQ scheduler to run early: `redis-cli ... ZADD bull:truck-idle-check:repeat:... now 0` or wait 35 min.
4. Admin sees an alert in `/alerts` and a push notification.

### 12.5 Fuel flow regression

- Open the driver fuel screen → exactly 3 visible screens (liters → photo → confirm).
- Submit with offline radio → row enqueued in `sync_queue` with `odometer_km: null`.
- Server log shows `INSERT INTO fuel_logs ... odometer_km = NULL` succeeded.

### 12.6 Presence indicator

- `select id, last_seen_at from users where id = '<my id>';` — value is within last 60 s while mobile is open.
- Kill the mobile app process → after 90 s, admin board shows the dot grey.

---

## 13 · PR Strategy

**One PR, branch `feat/plan-c-trips-fleet`.** Reviewable in 4 logical commits:

1. `migration + types + validation` (foundation, no behavior change yet).
2. `backend (trips multi-iteration, fuel, deposit, heartbeat, idle processor)`.
3. `mobile (fuel flow, loader recall, deposit group, iteration badge, heartbeat)`.
4. `admin web (presence dot, multi-trip TruckPlanBoard, i18n keys)`.

Sequencing matters only across plans, not inside Plan C: open the PR after Plan B has merged so the `parcelsService.advanceHarvestOnLoadEvent` import resolves. If Plan B is delayed beyond a day, ship Plan C with the calls wrapped in `try/catch` and a TODO; merge a follow-up PR once Plan B exists.

Run the `/strawboss-bug-hunt` skill on the PR before merge — focus areas to call out in the PR description: SQL injection in dynamic JSONB filters, race conditions on `createNextIteration`, BullMQ duplicate jobs at deploy time.

After merge: run `/strawboss-sync-docs` to update `docs/database.md`, `docs/backend.md`, `docs/mobile.md`, `docs/sync-protocol.md`.

---

## 14 · Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Race condition: two loaders both create iteration #2 | Med | High (duplicate trips) | Per-course `pg_advisory_xact_lock(hashtext('iter:'||rootId))` inside `createNextIteration` transaction (§6.1). Unique partial index `uq_trips_parent_iteration` is the belt-and-braces safety net — duplicate insert fails with `unique_violation`, caller retries. |
| Recall-prompt spam if `complete()` is retried | Low | Med (notification noise) | Loader push only fires once per trip — guard by checking `delivery_notes` for an existing `[recall_no]` or `[recall_yes]` marker before sending. If the marker is present, suppress the push. |
| Idle-alert flood (e.g. 100 trucks idle overnight) | Low | Med (admin sees 100 pushes at 06:00) | 60-min dedup per truck inside the processor; alert severity is `medium` not `high` so the admin panel groups them; document `STRAWBOSS_TRUCK_IDLE_THRESHOLD_MIN` env override for ops to tune. |
| Heartbeat eats battery / data | Low | Low | 30 s interval ≈ 2.5 MB / day at 50 bytes/req; stopped when app is backgrounded; admin can later opt for 60 s. |
| Migration backfill `UPDATE trips SET updated_at = NOW()` on large datasets bumps sync_version for everything → mobile clients pull every old trip | Med | Low (one-time large pull) | Limit the backfill to rows where `parent_trip_id IS NULL AND iteration_index = 1`; this is **every** row before this migration, so it's unavoidable, but cap mobile pull to 1000/batch (already in place). Document the expected first-sync size in the PR description. |
| Plan A and Plan C both edit `apps/mobile/app/(driver)/index.tsx` | High | Med (merge conflict) | Marker-comment contract in §3.1; small, localized edits only. CODEOWNERS file or PR template reminder. |
| `parcelsService.advanceHarvestOnLoadEvent` missing if Plan B lands later | Med | Low | Calls wrapped in try/catch; trip transitions never throw on the helper. |
| `depot_manager` users login but no depot is wired up to them | Med | Med | First version: `useDepotInventory(depotId)` accepts a manually-passed depotId from a dropdown of all org depots; v2: server resolves from `delivery_destinations.manager_user_id` (Plan A or follow-up). |
| Fuel reconciliation downstream of the dropped odometer breaks | Low | Low | `odometer_distance_km` is on `trips`, not `fuel_logs`; reconciliation already tolerates `odometer_km IS NULL` (verified by reading `reconciliation` module before merging). |

---

*Plan C ready for execution. Total expected diff: ~3500–4200 LOC across backend (40%), mobile (35%), admin-web (15%), packages (10%). Estimated calendar time with a single Opus 4.7 agent executing: 4 working days.*

# Security Audit — Multi-Tenancy Issues (2026-05-11)

> Issues found during post-implementation audit. C1–C6 and H1–H6 were already fixed.
> The issues below are **still open** as of this writing.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 8     | Open   |
| High     | 10    | Open   |
| Medium   | 4     | Open   |

---

## Critical

### CR-1 — Privilege escalation: any org admin can create/promote `super_admin` users

**Files:**
- `backend/service/src/admin-users/admin-users.controller.ts:38–57`
- `backend/service/src/admin-users/admin-users.service.ts:100–248`
- `packages/validation/src/schemas/user.schema.ts:33–55`

`POST /admin/users` and `PATCH /admin/users/:id` are guarded only by `@Roles('admin')`.
The role schema is `z.nativeEnum(UserRole)`, which includes `super_admin`.
An org admin can create or self-promote to `super_admin`, then use that JWT to access any org.

**Fix:** Strip `super_admin` (and `admin`) from the user-facing create/update role schema unless the caller is `super_admin`. Add a separate `adminCreateUserRoleSchema` enum that only contains non-privileged roles.

---

### CR-2 — `updateUser` mutates Supabase Auth before org ownership check

**File:** `backend/service/src/admin-users/admin-users.service.ts:147–248`

`supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role } })` and the PIN password update both fire before any `getById(id, orgId)` ownership check. The DB `UPDATE` is org-scoped so the row update no-ops for a foreign user, but the Supabase Auth role and password changes have already been applied — permanently locking out or hijacking any user in the system by UUID.

**Fix:** Call `getById(id, orgId)` at the top of `updateUser` before any Supabase Auth mutation.

---

### CR-3 — Machine FK in `updateUser` not org-scoped

**File:** `backend/service/src/admin-users/admin-users.service.ts:160–182`

The machine compatibility lookup at lines 166–170 has no `organization_id` filter. An admin can assign a machine from another org to their own users. Since `assigned_machine_id` is used to resolve the loader machine in trip creation, this can pull another org's machine into your org's trip pipeline.

**Fix:** Add `AND organization_id = ${orgId}::uuid` (when `orgId !== null`) to the machine SELECT.

---

### CR-4 — `CmrService.generateCmr` reads trips from any org

**Files:**
- `backend/service/src/documents/cmr/cmr.controller.ts:12–19`
- `backend/service/src/documents/cmr/cmr.service.ts:31–69`

```sql
SELECT * FROM trips WHERE id = ${tripId}::uuid AND deleted_at IS NULL LIMIT 1
```

No `organization_id` filter. A dispatcher in org A who knows or guesses a `tripId` from org B can generate a PDF with org B's PII (driver name, weights, parcel data). The resulting `documents` row is stamped with org A so org B never sees it.

**Fix:** Replace the raw trip SELECT with `tripsService.findById(tripId, orgId)` which already enforces org scope.

---

### CR-5 — Static file uploads bypass `AuthGuard` entirely

**File:** `backend/service/src/main.ts:42–49`

`@fastify/static` is registered directly on the Fastify instance before NestJS routing, so the global `AuthGuard` never runs for:

- `GET /api/v1/uploads/avatars/{userId}.webp` — filename is the user UUID, often visible in org member lists
- `GET /api/v1/uploads/receipts/{uuid}.webp` — random UUID, but once seen in a URL it's permanently public

Anyone on the internet can fetch these files without a token.

**Fix:** Replace the static handler with authenticated NestJS controller endpoints that stream the file after verifying the JWT (and for receipts, that the caller's org owns the resource).

---

### CR-6 — `LocationService` has no org filter anywhere

**File:** `backend/service/src/location/location.service.ts`

Every method is unscoped:

- `getLastKnownPositions()` — returns live GPS of every machine in every org
- `getRouteHistory(machineId, from, to)` — returns full GPS route history for any UUID
- `getTrucksAtLoader(loaderMachineId)` — finds all trucks in radius regardless of org
- `reportLocation(dto, operatorId)` — accepts any `machineId`; an operator can write GPS pings to another org's machine, poisoning its location history and route

**Fix:** Pass `orgId` from the controller into every method. Add `AND m.organization_id = ${orgId}::uuid` to all machine joins. In `reportLocation`, verify the machine belongs to the caller's org before inserting.

---

### CR-7 — `simulatePush` can target any org's user

**Files:**
- `backend/service/src/notifications/notifications.controller.ts:33–50`
- `backend/service/src/notifications/notifications.service.ts:43–50`

The admin-only endpoint accepts any `userId` UUID without checking that the target user belongs to the caller's org. An org admin can send arbitrary templated push notifications (fake trip disputes, geofence confirmations, etc.) to users in other orgs.

**Fix:** Before sending, verify the target user shares the caller's org — mirror the check already in `broadcast` for `target.kind === 'user'`.

---

### CR-8 — `DevController` sends cross-org pushes when `STRAWBOSS_ENABLE_DEV=1`

**Files:**
- `backend/service/src/dev/dev.controller.ts:33–84`
- `backend/service/src/dev/dev.service.ts:84–108`

`DevService.resolveTargetUserIds` queries `users` by `role` and `machineId` with no `organization_id` filter, and accepts a direct `userId` with no org check. On staging environments with `STRAWBOSS_ENABLE_DEV=1`, any org admin can fan out push notifications to all users of a given role across all orgs.

**Fix:** Either gate the entire `DevModule` behind `super_admin` role only, or thread `orgId` through `resolveTargetUserIds` and filter every branch.

---

## High

### H-7 — `FuelLogsService.create` writes cross-org machine odometer/hourmeter

**File:** `backend/service/src/fuel-logs/fuel-logs.service.ts:79–121`

The `machineId` from the DTO is used directly in two `UPDATE machines SET current_odometer_km = ..., current_hourmeter_hrs = ...` statements (lines 100–117) with no `organization_id` predicate. An operator can ratchet another org's machine odometer upward, corrupting fraud detection and reconciliation. The `fuel_logs` row itself is stamped with the caller's org but references a machine in a different org.

**Fix:** Verify `machine.organization_id === orgId` before insert. Add `AND organization_id = ${orgId}::uuid` to both `UPDATE machines` statements.

---

### H-8 — `BaleLoadsService.create` accepts trips from other orgs

**File:** `backend/service/src/bale-loads/bale-loads.service.ts:44–79`

Trip existence check (lines 45–50) has no `organization_id` filter. A loader in org A can POST `/bale-loads` with a `tripId` from org B, triggering `UPDATE trips SET bale_count = (SELECT SUM ...)` on org B's trip. The `bale_loads` row ends up invisible to both orgs (stamped org A, bound to org B's trip).

**Fix:** Add `AND organization_id = ${orgId}::uuid` to the trip existence check. Also add the same guard to the post-insert `UPDATE trips`.

---

### H-9 — `BaleProductionsService.create` accepts cross-org FKs

**File:** `backend/service/src/bale-productions/bale-productions.service.ts:141–159`

`parcelId`, `balerId`, and `operatorId` from the DTO are inserted without verifying they belong to the caller's org. A baler operator can log bale production against another org's parcel and machine.

**Fix:** Before insert, verify all three FKs belong to `orgId` (when not null).

---

### H-10 — `ConsumableLogsService.create` accepts cross-org FKs

**File:** `backend/service/src/consumable-logs/consumable-logs.service.ts:75–92`

Same pattern as H-7 and H-9. `dto.machineId`, `dto.parcelId`, and `dto.operatorId` are not verified against the caller's org.

**Fix:** Same as H-7 — verify FK org ownership before insert.

---

### H-11 — `SyncService.applyMutation` insert path does not verify FK org ownership

**File:** `backend/service/src/sync/sync.service.ts:174–225`

On insert the service stamps `organization_id = orgId` on the new row but never checks whether referenced FKs (`trip_id`, `parcel_id`, `machine_id`, `operator_id`) live in the same org. A mobile client can `POST /sync/push` with a `bale_loads.trip_id` from a different org; the post-insert `UPDATE trips SET bale_count = ...` (lines 213–224) has no `organization_id` guard, so it mutates the foreign org's trip aggregate.

**Fix:** Add a per-table FK org-ownership allowlist check before inserts. Add `AND organization_id = ${orgId}::uuid` to the post-insert trip `bale_count` update.

---

### H-12 — `SyncService.pull` misses `parcels` and `machines` in soft-delete list

**File:** `backend/service/src/sync/sync.service.ts:350–356`

`TABLES_WITH_SOFT_DELETE` lists trips, bale_loads, bale_productions, fuel_logs, consumable_logs, task_assignments — but not `parcels` or `machines`. Both tables have `deleted_at`. When a parcel or machine is soft-deleted on the server the mobile app keeps syncing and displaying it.

**Fix:** Add `'parcels'` and `'machines'` to `TABLES_WITH_SOFT_DELETE`.

---

### H-13 — `ParcelDailyStatusService` has no org filter on read, upsert, or delete

**Files:**
- `backend/service/src/parcel-daily-status/parcel-daily-status.service.ts`
- `backend/service/src/parcel-daily-status/parcel-daily-status.controller.ts`

- `listByDate(date)` — no org filter, returns every org's daily statuses; controller doesn't even pass `user.organizationId`
- `upsert(orgId, dto)` — does not verify `dto.parcelId` belongs to the caller's org
- `removeForDate(parcelId, statusDate)` — controller passes no `orgId`; any admin can delete another org's parcel daily status

**Fix:** Thread `orgId` through every method and JOIN with `parcels` to verify org ownership (the table has no `organization_id` column of its own).

---

### H-14 — `uploadUserAvatar` overwrites file before org ownership check

**File:** `backend/service/src/admin-users/admin-users.controller.ts:76–98`

`uploadsService.saveAvatar({ userId: id, ... })` writes `avatars/{id}.webp` to disk (line 91) before `setUserAvatar(id, user.organizationId, ...)` runs the org-scoped DB check (line 97). If the target `id` is a user in another org the DB update silently no-ops but the file on disk has already been overwritten.

**Fix:** Call `adminUsersService.getById(id, user.organizationId)` before saving the file. Abort with 403 if the user is not in the caller's org.

---

### H-15 — `TaskAssignmentsService.create`/`update` accept cross-org FKs

**File:** `backend/service/src/task-assignments/task-assignments.service.ts`

`create` (line ~434) inserts using DTO-supplied `machineId`, `parcelId`, `assignedUserId`, `parentAssignmentId`, `destinationId` with no FK org verification. `update` (line ~501) allows updating those same FKs via a fieldMap. A row stamped with org A can reference org B's machines, parcels, and users.

**Fix:** Before insert/update, verify each FK in the DTO belongs to `orgId`.

---

### H-16 — `TripsService.create`/`registerLoad` accept cross-org FKs

**File:** `backend/service/src/trips/trips.service.ts`

`create` (lines 212–240) and `registerLoad` (lines 347–567) accept `truckId`, `driverId`, `loaderId`, `loaderOperatorId`, `sourceParcelId` from the DTO with no verification that any of them belong to `orgId`.

**Fix:** Same as H-15 — validate every FK against the trip's org before inserting.

---

### H-17 — `ProfileService.changePassword` does not verify the current password

**File:** `backend/service/src/profile/profile.service.ts:83–104`

The method signature is `changePassword(userId, _currentPassword, newPassword)`. The underscore prefix and implementation confirm `_currentPassword` is never verified. Any stolen or XSS-obtained session token can permanently take over an account by setting an arbitrary new password.

**Fix:** Re-authenticate with `supabase.auth.signInWithPassword({ email, password: currentPassword })` before issuing `admin.updateUserById`. Return 401 on failure.

---

## Medium

### M-1 — `AlertsController.create` has no input validation

**File:** `backend/service/src/alerts/alerts.controller.ts:20–27`

No `ZodValidationPipe`. `category` and `severity` go straight into an INSERT.

**Fix:** Create `createAlertSchema` and apply it via `ZodValidationPipe`.

---

### M-2 — `NotificationsController.registerToken` has no input validation

**File:** `backend/service/src/notifications/notifications.controller.ts:16–28`

`body.token` and `body.platform` are inserted without schema validation.

**Fix:** Add a Zod schema for `{ token: string; platform: string; machineId?: string }` and apply `ZodValidationPipe`.

---

### M-3 — Controllers use `user.organizationId ?? ''` which throws a Postgres UUID cast error for `super_admin`

**Files:**
- `backend/service/src/farms/farms.controller.ts:38`
- `backend/service/src/machines/machines.controller.ts:46`
- `backend/service/src/parcels/parcels.controller.ts:58`
- `backend/service/src/delivery-destinations/delivery-destinations.controller.ts:46`

When `organizationId === null` (super_admin), these controllers fall back to `''`, which Postgres rejects as `invalid input syntax for type uuid`. Super_admin cannot create farms, machines, parcels, or delivery destinations via the API.

**Fix:** Either pass `null` directly and handle it in the service, or accept an explicit `orgId` query/body parameter for super_admin calls.

---

### M-4 — `SyncService.pull` filters `bale_loads` by `operator_id`, breaking loader offline reads

**File:** `backend/service/src/sync/sync.service.ts:343–347`

The owner filter restricts loader operators to seeing only `bale_loads` they personally created, but the loader app needs all loads for the active trip to compute totals. This breaks the offline-first guarantee.

**Fix:** Remove `bale_loads` from the `operator_id` owner filter, or scope by `trip_id` derived from the user's current assignment.

---

## Already Fixed (reference)

| ID | Description |
|----|-------------|
| C1 | `roles.guard.ts` — super_admin bypasses @Roles() |
| C2 | `parcels.service.ts` — getBaleAvailability cross-org |
| C3 | `parcels.service.ts` + parcel-daily-status — applyHarvestStatus org guard |
| C4 | `notifications.service.ts` — confirmParcelDone org stamp + ownership check |
| C5 | `notifications.service.ts` — broadcast all target kinds org-scoped |
| C6 | `sync.service.ts` — ownership guard || vs && logic |
| H1 | `task-assignments.service.ts` — updateStatus/startByOperator org guard |
| H2 | `task-assignments.service.ts` — getDailyPlan machines + parcel filters |
| H3 | `task-assignments.service.ts` — autoCompletePastAssignments + cascadeToAvailable |
| H4 | `documents.service.ts` — updateStatus org guard |
| H5 | `trips.service.ts` — generateTripNumber per-org sequence |
| H6 | `[slug]/(dashboard)/layout.tsx` — no-org users redirected to /login |

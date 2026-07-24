# Aux Trip Pickup Source (Depot or Field) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dispatcher confirming a pending aux trip request pick either a depot **or** a field
(reusing the existing `FarmParcelCascade` farm→parcel picker from the task boards) as the pickup
point communicated to the external driver — today only a depot is offered.

**Architecture:** A new nullable `trip_requests.source_parcel_id` column, sibling to the existing
`source_depot_id`. `confirmTripRequestSchema` XORs the two. `ConfirmRequestModal` gains a
depot/field tab switch; the field tab renders `FarmParcelCascade` + a map-picker fallback exactly
as the task boards do. The BullMQ confirmation email/SMS job branches on which source is set. The
real trip's `source_parcel_id` (set later, when a loader is assigned on the truck board) is
**untouched** — this feature only changes what's communicated to the external driver at confirm
time, matching the existing (already limited) scope of the depot picker today.

**Tech Stack:** PostgreSQL/PostGIS (Supabase), Drizzle raw `sql` tagged templates, NestJS 11 +
Fastify, Zod, BullMQ, Next.js 15 App Router, TanStack Query, Leaflet.

## Global Constraints

- Depot tab is the default (`sourceType` state starts as `'depot'`) — an untouched confirm behaves
  exactly as it does today. Regression safety, not a preference.
- No DB-level CHECK constraint for the depot/field exclusivity — `trip_requests.source_depot_id`
  has none today either; exclusivity is enforced once, at the Zod layer
  (`confirmTripRequestSchema`), mirroring the established `registerLoadSchema`/`forceStatusSchema`
  XOR pattern in `packages/validation/src/dtos/trip-transition.schema.ts`.
- **Do not touch** `autoUpsertAuxiliaryTrip` or the truck-board loader-assignment flow
  (`TruckPlanBoard.tsx`'s "Loader selector"). The real trip's `source_parcel_id` stays driven by
  the assigned loader's own task, unchanged. This feature is scoped entirely to
  `ConfirmRequestModal` → `trip_requests` → the confirmation email/SMS.
- No route/distance/static-map computed for a field-sourced pickup in the confirmation email —
  label only (`"<parcel code>, <farm name>"`). The depot branch keeps its existing OSRM route +
  static map behavior unchanged.
- No mobile app changes. This flow is entirely admin-web/dispatcher-facing.
- **Shared packages resolve via `dist/`, not source** — `@strawboss/types`, `@strawboss/validation`,
  and `@strawboss/api` all have `"types": "./dist/index.d.ts"` in `package.json`. After editing a
  shared package's `src/`, run `pnpm --filter @strawboss/<pkg> build` (not just `typecheck`) before
  typechecking a downstream consumer, or the consumer will typecheck against a stale `dist/`.
- `backend/service` and `apps/admin-web` have **no test runner** — verification per task is
  `pnpm --filter @strawboss/backend typecheck` / `./strawboss.sh typecheck admin-web` plus the
  manual check described in the task. Do not run `nest build`, `next build`, or `pnpm dev` — the
  product owner builds/runs the app himself (standing preference). `./strawboss.sh db:migrate` is
  the one exception: run it directly, it's pre-authorized.
- Every user-facing string goes through `t('tripRequests....')` (new keys) or reuses existing
  `t('tasks....')` keys, added to **both** `apps/admin-web/messages/en.json` and
  `apps/admin-web/messages/ro.json` — never a hardcoded string in JSX.

---

### Task 1: Migration — `trip_requests.source_parcel_id`

**Files:**
- Create: `supabase/migrations/00090_trip_request_source_parcel.sql`

**Interfaces:**
- Produces: `trip_requests.source_parcel_id UUID REFERENCES parcels(id)` (nullable) — consumed by
  Task 4 (backend service) and Task 6 (frontend, indirectly via the `sourceParcelId` type field
  from Task 2).

- [ ] **Step 1: Create the migration file**

```sql
-- 00090_trip_request_source_parcel.sql
-- Sibling to 00070_trip_request_source_depot.sql: a confirmed trip_request may
-- instead source directly from a field. Nullable; the app layer (not the DB)
-- enforces "confirm requires exactly one of depotId/parcelId" via
-- confirmTripRequestSchema, same as source_depot_id today. Idempotent.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS source_parcel_id UUID REFERENCES parcels(id);

CREATE INDEX IF NOT EXISTS idx_trip_requests_source_parcel
  ON trip_requests (source_parcel_id)
  WHERE source_parcel_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `./strawboss.sh db:migrate`
Expected: `00090_trip_request_source_parcel.sql` prints `ok` (every earlier file prints `skip` —
already applied).

- [ ] **Step 3: Verify the column exists**

Run:
```bash
psql "$DATABASE_URL" -t -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'trip_requests' AND column_name = 'source_parcel_id';"
```
Expected: one row, `source_parcel_id | uuid`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00090_trip_request_source_parcel.sql
git commit -m "feat(db): add trip_requests.source_parcel_id for field-sourced aux pickups"
```

---

### Task 2: `packages/types` — `TripRequest.sourceParcelId`/`sourceParcelName`

**Files:**
- Modify: `packages/types/src/entities/trip-request.ts`

**Interfaces:**
- Produces: `TripRequest.sourceParcelId: string | null`, `TripRequest.sourceParcelName?: string |
  null` — consumed by Task 4 (backend column list) and Task 9 (`RequestDetailsModal`,
  `AuxTripTable`, the read-only displays of what was confirmed).

- [ ] **Step 1: Add `sourceParcelId` next to the existing `sourceDepotId`**

Find:
```ts
  // pickup source depot chosen by the dispatcher on confirm
  sourceDepotId: string | null;
  // linkage, filled on confirm
  machineId: string | null;
```

Replace with:
```ts
  // pickup source depot chosen by the dispatcher on confirm
  sourceDepotId: string | null;
  // pickup source field chosen by the dispatcher on confirm (alternative to sourceDepotId)
  sourceParcelId: string | null;
  // linkage, filled on confirm
  machineId: string | null;
```

- [ ] **Step 2: Add `sourceParcelName` next to the existing `sourceDepotName`**

Find:
```ts
  // resolved names for the ids above (joined from delivery_destinations / users)
  sourceDepotName?: string | null;
  confirmedByName?: string | null;
```

Replace with:
```ts
  // resolved names for the ids above (joined from delivery_destinations / users / parcels)
  sourceDepotName?: string | null;
  sourceParcelName?: string | null;
  confirmedByName?: string | null;
```

- [ ] **Step 3: Build the package**

Run: `pnpm --filter @strawboss/types build`
Expected: exits 0, no output errors.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @strawboss/types typecheck`
Expected: passes cleanly.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/entities/trip-request.ts
git commit -m "feat(types): add TripRequest.sourceParcelId/sourceParcelName"
```

---

### Task 3: `packages/validation` — XOR `depotId`/`parcelId` on confirm

**Files:**
- Modify: `packages/validation/src/schemas/trip-request.schema.ts:143-149`

**Interfaces:**
- Consumes: nothing new.
- Produces: `confirmTripRequestSchema` now accepts `{ internalCode?, depotId?, parcelId? }` with
  exactly one of `depotId`/`parcelId` required — consumed by Task 4 (backend controller pipe) and
  Task 6 (frontend hook, informally — the frontend doesn't import this schema, but must match its
  shape).

- [ ] **Step 1: Replace `confirmTripRequestSchema` with the XOR'd version**

Find:
```ts
/** Body for confirming a request (admin/dispatcher). */
export const confirmTripRequestSchema = z.object({
  // Optional override of the internal code for the spawned auxiliary truck.
  internalCode: z.string().min(1).max(40).optional(),
  // Source depot (delivery_destination) the driver picks the goods up from.
  depotId: uuidSchema,
});
export type ConfirmTripRequestInput = z.infer<typeof confirmTripRequestSchema>;
```

Replace with:
```ts
/**
 * Body for confirming a request (admin/dispatcher).
 *
 * The pickup source is EITHER a depot or a field, never both — mirrors the XOR
 * already established for `registerLoadSchema`/`forceStatusSchema` in
 * trip-transition.schema.ts (goods come off a field or out of a depot, never both).
 */
export const confirmTripRequestSchema = z
  .object({
    // Optional override of the internal code for the spawned auxiliary truck.
    internalCode: z.string().min(1).max(40).optional(),
    // Source depot (delivery_destination) the driver picks the goods up from.
    depotId: uuidSchema.optional(),
    // Source field (parcel) the driver picks the goods up from directly.
    parcelId: uuidSchema.optional(),
  })
  .refine((d) => !!d.depotId !== !!d.parcelId, {
    message: 'exactly one of depotId or parcelId is required',
  });
export type ConfirmTripRequestInput = z.infer<typeof confirmTripRequestSchema>;
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @strawboss/validation build`
Expected: exits 0.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @strawboss/validation typecheck`
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/validation/src/schemas/trip-request.schema.ts
git commit -m "feat(validation): XOR depotId/parcelId on confirmTripRequestSchema"
```

---

### Task 4: Backend — `TripRequestsService.confirm()` + controller accept `parcelId`

**Files:**
- Modify: `backend/service/src/trip-requests/trip-requests.service.ts:62-130` (`TR_COLS`),
  `:335-402` (`confirm()`)
- Modify: `backend/service/src/trip-requests/trip-requests.controller.ts:61-70`

**Interfaces:**
- Consumes: `trip_requests.source_parcel_id` (Task 1), `confirmTripRequestSchema` XOR (Task 3).
- Produces: `TripRequest.sourceParcelId`/`sourceParcelName` populated in every `TR_COLS` read;
  `TripRequestsService.confirm(orgId, id, userId, depotId?, parcelId?, internalCode?)` — new
  signature, consumed by the controller in this same task.

- [ ] **Step 1: Add `source_parcel_id`/`sourceParcelName` to `TR_COLS`**

Find:
```ts
  trip_requests.notify_recipients            AS "notifyRecipients",
  trip_requests.source_depot_id              AS "sourceDepotId",
  trip_requests.created_at               AS "createdAt",
```

Replace with:
```ts
  trip_requests.notify_recipients            AS "notifyRecipients",
  trip_requests.source_depot_id              AS "sourceDepotId",
  trip_requests.source_parcel_id             AS "sourceParcelId",
  trip_requests.created_at               AS "createdAt",
```

Find:
```ts
  (SELECT dd.name       FROM delivery_destinations dd WHERE dd.id = trip_requests.source_depot_id) AS "sourceDepotName",
  (SELECT u.full_name   FROM users u                  WHERE u.id = trip_requests.confirmed_by)     AS "confirmedByName",
```

Replace with:
```ts
  (SELECT dd.name       FROM delivery_destinations dd WHERE dd.id = trip_requests.source_depot_id) AS "sourceDepotName",
  (SELECT p.code || COALESCE(', ' || p.farm_name, '')
                        FROM parcels p                WHERE p.id = trip_requests.source_parcel_id) AS "sourceParcelName",
  (SELECT u.full_name   FROM users u                  WHERE u.id = trip_requests.confirmed_by)     AS "confirmedByName",
```

- [ ] **Step 2: Replace the `confirm()` method**

Find:
```ts
  async confirm(
    orgId: string | null,
    id: string,
    userId: string,
    depotId: string,
    internalCode?: string,
  ) {
    const req = await this.findById(orgId, id);
    if (req.status !== RequestStatus.pending) {
      throw new BadRequestException('Cererea a fost deja procesată.');
    }
    // The pickup depot must belong to the request's org.
    const depotRows = (await this.drizzleProvider.db.execute(
      sql`SELECT 1 FROM delivery_destinations
          WHERE id = ${depotId}::uuid
            AND organization_id = ${req.organizationId}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as unknown[];
    if (!depotRows.length) throw new BadRequestException('Depozit invalid.');

    const code = internalCode ?? `AUX-${randomUUID().slice(0, 6).toUpperCase()}`;

    const machineRows = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO machines (
            organization_id, machine_type, is_auxiliary,
            registration_plate, internal_code, make, model,
            owner_company_name, owner_company_address, owner_company_cui,
            is_active
          ) VALUES (
            ${req.organizationId}::uuid, 'truck'::machine_type, true,
            ${req.truckRegistrationPlate}, ${code}, ${req.truckMake ?? null}, ${req.truckModel ?? null},
            ${req.companyName ?? null}, ${req.companyAddress ?? null}, ${req.companyCui ?? null},
            true
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    const machineId = machineRows[0]?.id;

    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trip_requests SET
            status = ${RequestStatus.confirmed}::request_status,
            machine_id = ${machineId}::uuid,
            source_depot_id = ${depotId}::uuid,
            confirmed_by = ${userId}::uuid,
            confirmed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${id}::uuid
          RETURNING ${TR_COLS}`,
    )) as unknown as TripRequest[];

    this.winston.log('flow', `Trip request ${id} confirmed → aux truck ${machineId}`, {
      context: 'TripRequestsService',
      requestId: id,
      machineId,
    });

    // Dispatch the detailed transport-confirmation email (driver + requester) and
    // the driver SMS asynchronously — the route/map/distance rendering happens in
    // the processor so confirm() stays fast.
    await this.messageQueue.add(
      'transport-confirmation',
      { requestId: id, depotId },
      { removeOnComplete: true, attempts: 1 },
    );

    return updated[0];
  }
```

Replace with:
```ts
  async confirm(
    orgId: string | null,
    id: string,
    userId: string,
    depotId?: string,
    parcelId?: string,
    internalCode?: string,
  ) {
    const req = await this.findById(orgId, id);
    if (req.status !== RequestStatus.pending) {
      throw new BadRequestException('Cererea a fost deja procesată.');
    }
    if (depotId) {
      // The pickup depot must belong to the request's org.
      const depotRows = (await this.drizzleProvider.db.execute(
        sql`SELECT 1 FROM delivery_destinations
            WHERE id = ${depotId}::uuid
              AND organization_id = ${req.organizationId}::uuid
              AND deleted_at IS NULL
            LIMIT 1`,
      )) as unknown as unknown[];
      if (!depotRows.length) throw new BadRequestException('Depozit invalid.');
    } else if (parcelId) {
      // The pickup field must belong to the request's org.
      const parcelRows = (await this.drizzleProvider.db.execute(
        sql`SELECT 1 FROM parcels
            WHERE id = ${parcelId}::uuid
              AND organization_id = ${req.organizationId}::uuid
              AND deleted_at IS NULL
            LIMIT 1`,
      )) as unknown as unknown[];
      if (!parcelRows.length) throw new BadRequestException('Parcelă invalidă.');
    }

    const code = internalCode ?? `AUX-${randomUUID().slice(0, 6).toUpperCase()}`;

    const machineRows = (await this.drizzleProvider.db.execute(
      sql`INSERT INTO machines (
            organization_id, machine_type, is_auxiliary,
            registration_plate, internal_code, make, model,
            owner_company_name, owner_company_address, owner_company_cui,
            is_active
          ) VALUES (
            ${req.organizationId}::uuid, 'truck'::machine_type, true,
            ${req.truckRegistrationPlate}, ${code}, ${req.truckMake ?? null}, ${req.truckModel ?? null},
            ${req.companyName ?? null}, ${req.companyAddress ?? null}, ${req.companyCui ?? null},
            true
          )
          RETURNING id`,
    )) as unknown as { id: string }[];
    const machineId = machineRows[0]?.id;

    const updated = (await this.drizzleProvider.db.execute(
      sql`UPDATE trip_requests SET
            status = ${RequestStatus.confirmed}::request_status,
            machine_id = ${machineId}::uuid,
            source_depot_id = ${depotId ?? null}::uuid,
            source_parcel_id = ${parcelId ?? null}::uuid,
            confirmed_by = ${userId}::uuid,
            confirmed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${id}::uuid
          RETURNING ${TR_COLS}`,
    )) as unknown as TripRequest[];

    this.winston.log('flow', `Trip request ${id} confirmed → aux truck ${machineId}`, {
      context: 'TripRequestsService',
      requestId: id,
      machineId,
    });

    // Dispatch the detailed transport-confirmation email (driver + requester) and
    // the driver SMS asynchronously — the route/map/distance rendering happens in
    // the processor so confirm() stays fast.
    await this.messageQueue.add(
      'transport-confirmation',
      { requestId: id, depotId, parcelId },
      { removeOnComplete: true, attempts: 1 },
    );

    return updated[0];
  }
```

- [ ] **Step 3: Update the controller to pass `parcelId` through**

Find:
```ts
  @Post(':id/confirm')
  @Roles(UserRole.admin, UserRole.dispatcher)
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmTripRequestSchema))
    dto: { internalCode?: string; depotId: string },
  ) {
    return this.service.confirm(this.requireOrg(user), id, user.id, dto.depotId, dto.internalCode);
  }
```

Replace with:
```ts
  @Post(':id/confirm')
  @Roles(UserRole.admin, UserRole.dispatcher)
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmTripRequestSchema))
    dto: { internalCode?: string; depotId?: string; parcelId?: string },
  ) {
    return this.service.confirm(
      this.requireOrg(user),
      id,
      user.id,
      dto.depotId,
      dto.parcelId,
      dto.internalCode,
    );
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @strawboss/backend typecheck`
Expected: passes cleanly.

- [ ] **Step 5: Commit**

```bash
git add backend/service/src/trip-requests/trip-requests.service.ts backend/service/src/trip-requests/trip-requests.controller.ts
git commit -m "feat(backend): trip-requests confirm accepts a field (parcel) pickup source"
```

---

### Task 5: Backend — confirmation email/SMS branches on depot vs. field

**Files:**
- Modify: `backend/service/src/messaging/transport-confirmation.processor.ts`

**Interfaces:**
- Consumes: `{ requestId, depotId?, parcelId? }` job payload (Task 4).
- Produces: nothing consumed by later tasks — this is the leaf of the backend chain.

- [ ] **Step 1: Rename `DepotRow` → `PickupSourceRow` (same shape, now source-agnostic)**

Find:
```ts
interface DepotRow {
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
}
```

Replace with:
```ts
interface PickupSourceRow {
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
}
```

- [ ] **Step 2: Accept `parcelId` from the job payload**

Find:
```ts
    if (job.name !== 'transport-confirmation') return;
    const { requestId, depotId } = job.data as { requestId: string; depotId: string };
```

Replace with:
```ts
    if (job.name !== 'transport-confirmation') return;
    const { requestId, depotId, parcelId } = job.data as {
      requestId: string;
      depotId?: string;
      parcelId?: string;
    };
```

- [ ] **Step 3: Branch the pickup-source query on depot vs. field**

Find:
```ts
    const depotRows = (await this.drizzleProvider.db.execute(
      sql`SELECT name, address,
                 COALESCE(ST_Y(coords), ST_Y(ST_Centroid(boundary))) AS lat,
                 COALESCE(ST_X(coords), ST_X(ST_Centroid(boundary))) AS lon
          FROM delivery_destinations WHERE id = ${depotId}::uuid LIMIT 1`,
    )) as unknown as DepotRow[];
    const depot = depotRows[0];
```

Replace with:
```ts
    let source: PickupSourceRow | undefined;
    if (depotId) {
      const depotRows = (await this.drizzleProvider.db.execute(
        sql`SELECT name, address,
                   COALESCE(ST_Y(coords), ST_Y(ST_Centroid(boundary))) AS lat,
                   COALESCE(ST_X(coords), ST_X(ST_Centroid(boundary))) AS lon
            FROM delivery_destinations WHERE id = ${depotId}::uuid LIMIT 1`,
      )) as unknown as PickupSourceRow[];
      source = depotRows[0];
    } else if (parcelId) {
      // Field-sourced pickup: label only, no coordinates — the route/map block
      // below is gated on `pickupCoords`, so it naturally skips for a field.
      const parcelRows = (await this.drizzleProvider.db.execute(
        sql`SELECT (code || COALESCE(', ' || farm_name, '')) AS name,
                   NULL::text AS address, NULL::float8 AS lat, NULL::float8 AS lon
            FROM parcels WHERE id = ${parcelId}::uuid LIMIT 1`,
      )) as unknown as PickupSourceRow[];
      source = parcelRows[0];
    }
```

- [ ] **Step 4: Update the two remaining `depot` references**

Find:
```ts
    const pickupCoords: LatLon | null =
      depot?.lat != null && depot?.lon != null ? { lat: depot.lat, lon: depot.lon } : null;
```

Replace with:
```ts
    const pickupCoords: LatLon | null =
      source?.lat != null && source?.lon != null ? { lat: source.lat, lon: source.lon } : null;
```

Find:
```ts
    const pickup = {
      label: depot?.name ?? 'Depozit',
      address: depot?.address ?? null,
      mapsUrl: pickupCoords ? fmtCoordsUrl(pickupCoords.lat, pickupCoords.lon) : null,
    };
```

Replace with:
```ts
    const pickup = {
      label: source?.name ?? 'Depozit',
      address: source?.address ?? null,
      mapsUrl: pickupCoords ? fmtCoordsUrl(pickupCoords.lat, pickupCoords.lon) : null,
    };
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @strawboss/backend typecheck`
Expected: passes cleanly.

- [ ] **Step 6: Commit**

```bash
git add backend/service/src/messaging/transport-confirmation.processor.ts
git commit -m "feat(backend): confirmation email/SMS shows field label for a field-sourced aux pickup"
```

---

### Task 6: `packages/api` — `useConfirmTripRequest` accepts `parcelId`

**Files:**
- Modify: `packages/api/src/hooks/use-trip-requests.ts:39-58`

**Interfaces:**
- Consumes: `TripRequest` type (Task 2, already includes `sourceParcelId`/`sourceParcelName`).
- Produces: `useConfirmTripRequest(client)` mutation now accepts `{ id, internalCode?, depotId?,
  parcelId? }` — consumed by Task 8 (`ConfirmRequestModal`).

- [ ] **Step 1: Widen the mutation variables and body**

Find:
```ts
export function useConfirmTripRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      internalCode,
      depotId,
    }: {
      id: string;
      internalCode?: string;
      depotId: string;
    }) =>
      client.post<TripRequest>(`/api/v1/trip-requests/${id}/confirm`, { internalCode, depotId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.machines.all });
      void qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}
```

Replace with:
```ts
export function useConfirmTripRequest(client: ApiClient) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      internalCode,
      depotId,
      parcelId,
    }: {
      id: string;
      internalCode?: string;
      depotId?: string;
      parcelId?: string;
    }) =>
      client.post<TripRequest>(`/api/v1/trip-requests/${id}/confirm`, {
        internalCode,
        depotId,
        parcelId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tripRequests.all });
      void qc.invalidateQueries({ queryKey: queryKeys.machines.all });
      void qc.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
    },
  });
}
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter @strawboss/api build`
Expected: exits 0.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @strawboss/api typecheck`
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/hooks/use-trip-requests.ts
git commit -m "feat(api): useConfirmTripRequest accepts a field (parcel) pickup source"
```

---

### Task 7: `admin-web` — i18n keys for the depot/field tabs

**Files:**
- Modify: `apps/admin-web/messages/en.json:1071-1081`
- Modify: `apps/admin-web/messages/ro.json:1071-1081`

**Interfaces:**
- Produces: `tripRequests.sourceTypeDepot`, `tripRequests.sourceTypeField`,
  `tripRequests.fieldLabel`, `tripRequests.fieldHint`, `tripRequests.fieldPlaceholder` — consumed
  by Task 8. (`tasks.selectOnMap`, `tasks.searchFarms`, `tasks.searchParcels`, `tasks.noFarms`,
  `tasks.noParcelsInFarm`, `tasks.pickFarmFirst`, `tasks.unassignedFarm` already exist and are
  reused as-is by `FarmParcelCascade`.)

- [ ] **Step 1: Add the five keys to `en.json`**

Find:
```json
    "depotLabel": "Pickup depot",
    "depotHint": "The depot the driver loads the goods from.",
    "depotPlaceholder": "— Select depot —",
    "pickupPreview": "Pickup",
```

Replace with:
```json
    "sourceTypeDepot": "Depot",
    "sourceTypeField": "Field",
    "depotLabel": "Pickup depot",
    "depotHint": "The depot the driver loads the goods from.",
    "depotPlaceholder": "— Select depot —",
    "fieldLabel": "Pickup field",
    "fieldHint": "The field the driver loads the goods from directly.",
    "fieldPlaceholder": "— Select a field —",
    "pickupPreview": "Pickup",
```

- [ ] **Step 2: Add the same five keys to `ro.json`, translated**

Find:
```json
    "depotLabel": "Depozit de ridicare",
    "depotHint": "Depozitul de unde șoferul încarcă marfa.",
    "depotPlaceholder": "— Alege depozit —",
    "pickupPreview": "Ridicare",
```

Replace with:
```json
    "sourceTypeDepot": "Depozit",
    "sourceTypeField": "Câmp",
    "depotLabel": "Depozit de ridicare",
    "depotHint": "Depozitul de unde șoferul încarcă marfa.",
    "depotPlaceholder": "— Alege depozit —",
    "fieldLabel": "Câmp de ridicare",
    "fieldHint": "Parcela de unde șoferul încarcă marfa direct din câmp.",
    "fieldPlaceholder": "— Alege un câmp —",
    "pickupPreview": "Ridicare",
```

- [ ] **Step 3: Verify both JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin-web/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/admin-web/messages/ro.json','utf8')); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/messages/en.json apps/admin-web/messages/ro.json
git commit -m "i18n: add keys for aux confirm depot/field source tabs"
```

---

### Task 8: `ConfirmRequestModal` — depot/field tabs, reusing `FarmParcelCascade`

**Files:**
- Modify: `apps/admin-web/src/components/features/trip-requests/ConfirmRequestModal.tsx` (full
  rewrite)

**Interfaces:**
- Consumes: `useConfirmTripRequest` (Task 6), `FarmParcelCascade` (existing,
  `apps/admin-web/src/components/features/tasks/machine-plan/FarmParcelCascade.tsx`), `ParcelMapModal`
  (existing, `apps/admin-web/src/components/features/tasks/daily-plan/ParcelMapModal.tsx`),
  `useParcels` (existing, `packages/api/src/hooks/use-parcels.ts`), i18n keys (Task 7).
- Produces: nothing consumed by a later task — this is the leaf of the frontend chain.

- [ ] **Step 1: Replace the full file contents**

```tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle2, XCircle, Loader2, MapPin, Warehouse, Sprout } from 'lucide-react';
import { useConfirmTripRequest, useDeliveryDestinations, useParcels } from '@strawboss/api';
import type { TripRequest, DeliveryDestination, Parcel } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { normalizeList } from '@/lib/normalize-api-list';
import { FarmParcelCascade } from '@/components/features/tasks/machine-plan/FarmParcelCascade';

const ParcelMapModal = dynamic(
  () =>
    import('@/components/features/tasks/daily-plan/ParcelMapModal').then((m) => m.ParcelMapModal),
  { ssr: false },
);

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// Stable references — FarmParcelCascade takes these as props and re-creating
// them every render would be a pointless allocation (they're both always empty
// in this one-off confirm context: no other assignment exists yet to exclude
// or count against).
const EMPTY_EXCLUDE = new Set<string>();
const EMPTY_ASSIGNED_COUNT = new Map<string, number>();

type SourceType = 'depot' | 'field';

/**
 * Confirm a pending request → mints the one-time auxiliary truck.
 *
 * The pickup point (depot OR field, exactly one) is the informational source
 * communicated to the external driver (an aux transport runs our pickup point →
 * the customer's yard, the opposite direction from a fleet trip) — required.
 */
export function ConfirmRequestModal({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [internalCode, setInternalCode] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('depot');
  const [depotId, setDepotId] = useState('');
  const [parcelId, setParcelId] = useState('');
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [showParcelMap, setShowParcelMap] = useState(false);
  const confirm = useConfirmTripRequest(apiClient);
  const { data: rawDepots } = useDeliveryDestinations(apiClient);
  const { data: rawParcels } = useParcels(apiClient);
  const depots = useMemo(
    () => normalizeList<DeliveryDestination>(rawDepots).filter((d) => d.isActive),
    [rawDepots],
  );
  const parcels = useMemo(() => normalizeList<Parcel>(rawParcels), [rawParcels]);

  // Preselect the default (or first) depot once the list loads.
  useEffect(() => {
    if (!depotId && depots.length) {
      setDepotId((depots.find((d) => d.isDefault) ?? depots[0]).id);
    }
  }, [depots, depotId]);

  const selectedDepot = depots.find((d) => d.id === depotId) ?? null;
  const selectedParcel = parcels.find((p) => p.id === parcelId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = internalCode.trim() || undefined;
    if (sourceType === 'depot') {
      if (!depotId) return;
      confirm.mutate(
        { id: request.id, depotId, internalCode: code },
        { onSuccess: () => onClose() },
      );
    } else {
      if (!parcelId) return;
      confirm.mutate(
        { id: request.id, parcelId, internalCode: code },
        { onSuccess: () => onClose() },
      );
    }
  };

  const pickupLabel =
    sourceType === 'depot'
      ? selectedDepot
        ? `${selectedDepot.name}${selectedDepot.address ? `, ${selectedDepot.address}` : ''}`
        : '—'
      : selectedParcel
        ? `${selectedParcel.code}${selectedParcel.farmName ? `, ${selectedParcel.farmName}` : ''}`
        : '—';

  const canSubmit = sourceType === 'depot' ? !!depotId : !!parcelId;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {t('tripRequests.confirmModalTitle')}
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {request.requesterName} — {request.truckRegistrationPlate}
              </p>
            </div>

            {/* Depot vs. field tabs */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSourceType('depot')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                  sourceType === 'depot'
                    ? 'border-green-400 bg-green-50 text-green-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                )}
              >
                <Warehouse className="h-3.5 w-3.5" />
                {t('tripRequests.sourceTypeDepot')}
              </button>
              <button
                type="button"
                onClick={() => setSourceType('field')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                  sourceType === 'field'
                    ? 'border-green-400 bg-green-50 text-green-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                )}
              >
                <Sprout className="h-3.5 w-3.5" />
                {t('tripRequests.sourceTypeField')}
              </button>
            </div>

            {sourceType === 'depot' ? (
              <div>
                <label className="block text-sm font-medium text-neutral-700">
                  {t('tripRequests.depotLabel')} <span className="text-red-500">*</span>
                </label>
                <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.depotHint')}</p>
                <select
                  value={depotId}
                  onChange={(e) => setDepotId(e.target.value)}
                  required
                  className={inputCls}
                >
                  <option value="">{t('tripRequests.depotPlaceholder')}</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.address ? ` — ${d.address}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="relative">
                <label className="block text-sm font-medium text-neutral-700">
                  {t('tripRequests.fieldLabel')} <span className="text-red-500">*</span>
                </label>
                <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.fieldHint')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFieldPicker((v) => !v)}
                    className={cn(inputCls, 'flex-1 text-left')}
                  >
                    {selectedParcel
                      ? `${selectedParcel.code}${selectedParcel.farmName ? `, ${selectedParcel.farmName}` : ''}`
                      : t('tripRequests.fieldPlaceholder')}
                  </button>
                  <button
                    type="button"
                    data-cascade-keep-open
                    onClick={() => {
                      setShowParcelMap(true);
                      setShowFieldPicker(false);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {t('tasks.selectOnMap')}
                  </button>
                </div>
                {showFieldPicker && (
                  <FarmParcelCascade
                    parcels={parcels}
                    excludeParcelIds={EMPTY_EXCLUDE}
                    assignedCountByParcel={EMPTY_ASSIGNED_COUNT}
                    color="green"
                    onSelect={(id) => setParcelId(id)}
                    onClose={() => setShowFieldPicker(false)}
                  />
                )}
              </div>
            )}

            <div className="space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
              <p className="flex items-start gap-1.5">
                <Warehouse className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                <span>
                  <span className="font-medium">{t('tripRequests.pickupPreview')}:</span>{' '}
                  {pickupLabel}
                </span>
              </p>
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <span>
                  <span className="font-medium">{t('tripRequests.deliveryPreview')}:</span>{' '}
                  {request.destinationAddress || '—'}
                </span>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                {t('tripRequests.internalCodeLabel')}
              </label>
              <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.internalCodeHint')}</p>
              <input
                value={internalCode}
                onChange={(e) => setInternalCode(e.target.value)}
                placeholder={t('tripRequests.internalCodePlaceholder')}
                className={inputCls}
              />
            </div>
            {confirm.isError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {t('tripRequests.confirmError')}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={confirm.isPending || !canSubmit}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirm.isPending ? t('tripRequests.confirming') : t('tripRequests.confirm')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showParcelMap && (
        <ParcelMapModal
          parcels={parcels.filter((p) => p.isActive)}
          onSelect={(parcelIds) => {
            if (parcelIds[0]) setParcelId(parcelIds[0]);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: passes cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/components/features/trip-requests/ConfirmRequestModal.tsx
git commit -m "feat(trip-requests): confirm modal lets the dispatcher pick a field instead of a depot"
```

---

### Task 9: Read-only displays show the field-sourced pickup too

Two existing views already display the request-level `sourceDepotName` as a read-only "what was
picked at confirm" fact — a field-sourced request would otherwise show up blank in both. Found
during plan self-review by checking every existing consumer of `sourceDepotName`, not just the
confirm modal.

**Files:**
- Modify: `apps/admin-web/src/components/features/trip-requests/RequestDetailsModal.tsx:208`
- Modify: `apps/admin-web/src/components/features/trips/AuxTripTable.tsx:152`
- Modify: `apps/admin-web/messages/en.json:1034`
- Modify: `apps/admin-web/messages/ro.json:1034`

**Interfaces:**
- Consumes: `TripRequest.sourceParcelName` (Task 2).

- [ ] **Step 1: Add the `sourceField` i18n key to `en.json`**

Find:
```json
    "transporterAddress": "Transporter address",
    "sourceDepot": "Pickup depot",
    "cancellationReason": "Cancellation reason",
```

Replace with:
```json
    "transporterAddress": "Transporter address",
    "sourceDepot": "Pickup depot",
    "sourceField": "Pickup field",
    "cancellationReason": "Cancellation reason",
```

- [ ] **Step 2: Add the same key to `ro.json`, translated**

Find:
```json
    "transporterAddress": "Adresă transportator",
    "sourceDepot": "Depozit ridicare",
    "cancellationReason": "Motiv anulare",
```

Replace with:
```json
    "transporterAddress": "Adresă transportator",
    "sourceDepot": "Depozit ridicare",
    "sourceField": "Câmp ridicare",
    "cancellationReason": "Motiv anulare",
```

- [ ] **Step 3: `RequestDetailsModal` — show the field detail row too**

`Detail` already renders nothing when its `value` is null/undefined/empty (see the component's own
guard at the top of the file), so adding a second row is safe — only one of the two will ever
render for a given request.

Find:
```tsx
          <Section title={t('tripRequests.sectionStatus')}>
            <Detail label={t('tripRequests.sourceDepot')} value={r.sourceDepotName} />
            <Detail
```

Replace with:
```tsx
          <Section title={t('tripRequests.sectionStatus')}>
            <Detail label={t('tripRequests.sourceDepot')} value={r.sourceDepotName} />
            <Detail label={t('tripRequests.sourceField')} value={r.sourceParcelName} />
            <Detail
```

- [ ] **Step 4: `AuxTripTable` — fall back to the request-level field choice**

`tripSourceParcelName` (the REAL trip's parcel, once a loader is assigned) already takes priority
when set — this only adds the same before-a-trip-exists fallback the depot column already has.

Find:
```tsx
      render: (row) => {
        // What actually happened beats what was planned; show both when both exist.
        const parcel = row.request.tripSourceParcelName;
        const depot = row.request.tripSourceDepotName ?? row.request.sourceDepotName;
        const label = [parcel, depot].filter(Boolean).join(' · ');
        return <span className="text-xs text-neutral-700">{label || EMPTY}</span>;
      },
```

Replace with:
```tsx
      render: (row) => {
        // What actually happened beats what was planned; show both when both exist.
        const parcel = row.request.tripSourceParcelName ?? row.request.sourceParcelName;
        const depot = row.request.tripSourceDepotName ?? row.request.sourceDepotName;
        const label = [parcel, depot].filter(Boolean).join(' · ');
        return <span className="text-xs text-neutral-700">{label || EMPTY}</span>;
      },
```

- [ ] **Step 5: Verify both JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin-web/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/admin-web/messages/ro.json','utf8')); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 6: Typecheck**

Run: `./strawboss.sh typecheck admin-web`
Expected: passes cleanly.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/features/trip-requests/RequestDetailsModal.tsx apps/admin-web/src/components/features/trips/AuxTripTable.tsx apps/admin-web/messages/en.json apps/admin-web/messages/ro.json
git commit -m "feat(trip-requests): show the field-sourced pickup in the details modal and ledger table"
```

---

### Task 10: Full-stack manual verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the depot tab still works exactly as before**

With the dev server running (product owner's own instance, or ask them to check): open the Curse
page's aux section, confirm a pending request on the **Depozit** tab exactly as today. Verify it
still succeeds and the truck appears on `/tasks/trucks`. This is the regression check — nothing
about the depot path should have changed.

- [ ] **Step 2: Confirm the field tab end-to-end**

Confirm a different pending request on the **Câmp** tab: search for a farm, pick a parcel, and
separately try "Selectează pe hartă" to pick one from the map instead. Submit. Verify:
```bash
psql "$DATABASE_URL" -t -c "SELECT source_depot_id, source_parcel_id FROM trip_requests WHERE id = '<the request id>';"
```
Expected: `source_depot_id` is NULL, `source_parcel_id` is the picked parcel's id. Then open that
request's row in the aux ledger table (`AuxTripTable`) and its "Detalii" view
(`RequestDetailsModal`) — both should show the parcel's code/farm name in the pickup
column/detail, not a blank.

- [ ] **Step 3: Verify the confirmation email/SMS content**

Check `/messages` (or the configured email/SMS outbox) for the field-sourced confirmation: the
pickup line should show `"<parcel code>, <farm name>"` with no map image or route/distance line.
Compare against the depot-sourced one from Step 1, which should still show its route/map/distance
as before.

- [ ] **Step 4: Cross-org rejection**

Using an org-scoped admin session, attempt to confirm with a `parcelId` from a different
organization (e.g. via a direct API call with a known foreign parcel id). Expected: `400 Bad
Request` — `"Parcelă invalidă."`.

- [ ] **Step 5: Neither/both selected**

Confirm the submit button stays disabled with neither tab's field filled in. If forced via a
direct API call with both `depotId` and `parcelId` set, or neither, expect a `400` from
`confirmTripRequestSchema`'s refine.

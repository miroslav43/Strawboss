# Plan B — Baler Workflow & Harvest-Status State System

> **Owning agent:** Plan B agent (Opus 4.7, separate session)
> **Branch:** `feat/plan-b-baler-harvest`
> **Effort estimate:** ~3 dev-days (L) — touches DB, types, validation, backend, admin UI, mobile UI, mobile DB, sync.
> **Dependencies / blockers:**
> - **Plan A** owns map rendering (`LeafletMap.tsx`) — must verify it reads `harvestStatus` from parcels (no code change required from us).
> - **Plan C** owns trip/task-assignment lifecycle — Plan C must call the helper `parcelsService.advanceHarvestOnLoadEvent()` documented below.
> - Postgres migration **00042** (this plan); 00043 / 00044 reserved for Plan C / Plan A.

---

## 1. Scope & non-goals

### In scope (tasks from `tascuri.txt`)
- **T5** — Baler home: tapping a parcel/task navigates to a parcel detail screen.
- **T6** — Baler geofence UX:
  - **Enter** → popup with 10 s auto-confirm "Începi balotarea în această parcelă?" → on confirm parcel → `harvesting`, assignment → `in_progress`.
  - **Exit** → loud sound + push + popup → production entry page → operator chooses **Parțial finalizată** or **Total finalizată**.
- **T7** — Harvest-status hierarchy enforcement: `harvested` cannot be downgraded to `partial_harvested`. Enforced at DB (trigger), backend (validation), and mobile UI.
- **T9.1** — Add **crop type** field (enum + column + admin form + mobile read-only).
- **T9.2** — Remove `is_active` (active/inactive) flag from parcels everywhere.
- **T9.3** — Parcel display name = parcel `code` only; deprecate `name` in UI (column stays for now).
- **T9.10** — Full harvest-status state flow: `planned → to_harvest → harvesting → partial_harvested → harvested → in_loading → loaded → completed`.

### Out of scope (other plans)
- Map rendering of harvest status labels — Plan A.
- Realtime invalidation of parcels on harvest changes (RealtimeProvider) — Plan A owns the realtime list of channels; our migration just bumps `sync_version`.
- Trip lifecycle (loading/loaded/completed transitions of parcel) — Plan C *triggers* them via a hook we expose; we do not modify `trips.service.ts`.
- New "deposit inventory" mobile screen — owner Plan C (T12).

### Non-goals
- Dropping the `name` column physically — only hiding in UI / form (deferred to a later cleanup migration).
- Dropping `parcels.is_active` column — set DEFAULT TRUE and stop reading/writing it; leave column in place for one release to avoid breaking older mobile builds reading from `ALLOWED_COLUMNS`.
- Localizing crop type to languages other than RO/EN.

---

## 2. File ownership matrix

| File / area | Action |
|---|---|
| `packages/types/src/entities/parcel.ts` | Extend `HarvestStatus`, add `CropType`, mark `ParcelStatus` deprecated, add `cropType` to `Parcel`. |
| `packages/types/src/index.ts` | Re-export `CropType` (already re-exports `parcel.js`). |
| `packages/validation/src/schemas/parcel.schema.ts` | Mirror enum + add `cropType`; partial schemas keep `name`/`isActive` for backward-compat reads. |
| `packages/validation/src/index.ts` | Add `cropTypeSchema` re-export. |
| `supabase/migrations/00042_parcel_crop_and_harvest_extended.sql` | New migration (full SQL in §5). |
| `apps/admin-web/src/app/[slug]/(dashboard)/parcels/page.tsx` | Drop is_active toggle/filter, hide name input, add crop dropdown + filter, render harvest status with new entries, show parcel `code` as the display name in the table. |
| `apps/admin-web/src/components/shared/StatusBadge.tsx` | Already trip-only — add a sibling `<HarvestStatusBadge>` component (same file or sibling `HarvestStatusBadge.tsx`) with the new harvest enum values. We will not break `TripStatus`. |
| `apps/admin-web/messages/{en,ro}.json` | Add keys under `parcels.crop.*`, extend `parcels.harvest.*` with `partial_harvested`, `in_loading`, `loaded`, `completed`. Remove use of `parcels.filterActive/Inactive` from UI (keep keys for safety). |
| `apps/mobile/app/(baler)/index.tsx` | Pass a `roleOverride` to `TaskList` so baler taps navigate to parcel detail. |
| `apps/mobile/app/(baler)/parcel/[parcelId].tsx` | **New** screen — parcel detail (read-only) for T5. |
| `apps/mobile/app/baler-ops/production-entry.tsx` | **New** screen — bale-count entry + partial/total picker (T6 exit). |
| `apps/mobile/src/components/features/production/BalerEntryCountdown.tsx` | **New** — wraps `ConfirmCountdown` for the 10 s entry popup (T6 enter). |
| `apps/mobile/src/components/features/production/HarvestFinishPicker.tsx` | **New** — Partial / Total choice (T6 exit, T9.10). |
| `apps/mobile/src/components/features/production/index.ts` | Re-export the two new components. |
| `apps/mobile/src/components/shared/GeofenceOverlay.tsx` | Add an `entry_confirm` variant for baler (10 s countdown); keep deposit/exit unchanged. |
| `apps/mobile/src/hooks/useGeofenceNotifications.ts` | New alert type `entry_confirm`; extract `parcelId`, `parcelCode`, `cropType` from push payload; new method `cancelParcelEntry`. |
| `apps/mobile/src/components/shared/TaskList.tsx` | Add optional `onTaskPress` prop so baler home routes to parcel detail without changing loader/driver behavior. |
| `apps/mobile/src/db/schema.ts` | Add `crop_type` column to local `parcels` table; allow extended `harvest_status` values (TEXT, no enum). |
| `apps/mobile/src/db/migrations.ts` | `addColumnIfMissing('parcels', 'crop_type', 'TEXT')`. |
| `apps/mobile/assets/sounds/baler-exit.wav` | **New** asset — short loud horn (~1 s). Source / licensing TBD by the agent (royalty-free, e.g. freesound.org CC0). |
| `apps/mobile/app.json` | Register Android notification channel `baler-exit` referencing the sound (`expo-notifications` plugin). |
| `backend/service/src/parcels/parcels.service.ts` | Accept `cropType`; emit/validate extended `harvest_status`; expose `advanceHarvestOnLoadEvent()`; stop accepting `isActive` updates from API (silently ignore). |
| `backend/service/src/parcels/parcels.controller.ts` | Remove `isActive` query filter; accept `cropType` (already in DTO schema). |
| `backend/service/src/geofence/geofence.service.ts` | On baler **enter**: send `field_entry_confirm` push (not just `field_entry`) with `assignmentId`, `parcelId`, `parcelCode`, `cropType`. Do **not** auto-flip the assignment to `in_progress` — wait for the 10 s confirm POST. On baler **exit**: payload type stays `geofence_exit_confirm` but includes `parcelId`, `parcelCode`. |
| `backend/service/src/notifications/notifications.service.ts` | Add `sendBalerFieldEntryConfirm()` and `sendBalerFieldExitProduction()`. Other helpers untouched. |
| `backend/service/src/notifications/notifications.controller.ts` | Extend `/confirm-parcel-done` to accept `{ assignmentId, baleCount, finishState: 'partial' \| 'total' }`. Add `POST /confirm-parcel-entry` for the 10 s auto-confirm. |
| `backend/service/src/sync/sync.service.ts` | Add `'crop_type'` to `ALLOWED_COLUMNS.parcels`. |

### Files explicitly NOT touched
- `apps/admin-web/src/app/[slug]/(dashboard)/map/**`, `realtime.tsx`, `tasks/**`.
- `apps/mobile/app/(loader|driver|geofence-maker)/**`.
- `apps/mobile/src/components/features/{fuel,delivery,loading}/**`.
- `backend/service/src/trips/**`, `task-assignments/**`.
- Other entries in `notifications.service.ts` (`sendGeofenceExitNotification` stays as-is for legacy compat).

---

## 3. Coordination contracts

### 3.1 Helper exposed to Plan C

Plan C will trigger parcel status transitions from trip events. Plan B implements:

```ts
// backend/service/src/parcels/parcels.service.ts
export type HarvestLoadEvent =
  | 'loading_started'   // first bale_load row inserted for this parcel today
  | 'all_loaded'        // produced - loaded === 0 for this parcel
  | 'all_delivered';    // all trips carrying this parcel reached `completed`

/**
 * Advance a parcel's harvest_status based on a trip-lifecycle event from
 * Plan C. Idempotent: silently no-ops if the target state is already <=
 * current state (downgrade-prevented). Always scoped by orgId.
 *
 * State map:
 *   loading_started  : harvested | partial_harvested  -> in_loading
 *   all_loaded       : in_loading                     -> loaded
 *   all_delivered    : loaded                         -> completed
 *
 * - Calls the DB trigger-protected UPDATE; trigger throws on downgrade.
 * - Bumps `updated_at` so global sync_version (00040) increments.
 * - Logs winston `flow` line `parcels.harvest.advance` with parcelId, event,
 *   from -> to.
 * - Returns `{ updated: boolean, fromStatus, toStatus }` so callers can
 *   decide whether to notify.
 */
async advanceHarvestOnLoadEvent(
  parcelId: string,
  event: HarvestLoadEvent,
  orgId: string | null,
): Promise<{ updated: boolean; fromStatus: HarvestStatus; toStatus: HarvestStatus }>;
```

Plan C wires this in three places (Plan C's responsibility, listed here so we agree on signatures):
- `BaleLoadsService.create()` → after INSERT, if first load for `(parcelId, today)` → call `advanceHarvestOnLoadEvent(parcelId, 'loading_started', orgId)`.
- `TripsService.complete()` (or the dispatcher) → after re-computing bale availability, if `remaining === 0` and any trip carrying this parcel is still in transit → call `advanceHarvestOnLoadEvent(parcelId, 'all_loaded', orgId)`.
- Cron / trip-complete hook → when *all* trips referencing the parcel are `completed` → call `advanceHarvestOnLoadEvent(parcelId, 'all_delivered', orgId)`.

We do **not** add `ParcelsModule` as a circular dep — Plan C imports it via the existing module DI (it already does for `getBaleAvailability`).

### 3.2 Plan A — map labels

`LeafletMap.tsx` already renders a parcel field with `harvestStatus`. After 00042 lands the column carries new enum values; Plan A only needs to add CSS color tokens for `partial_harvested`, `in_loading`, `loaded`, `completed` if they want differentiated colors. Documentation handed via PR description.

### 3.3 Notifications module — additive only

Plan B adds **only** these two helpers in `notifications.service.ts`:

```ts
async sendBalerFieldEntryConfirm(
  userId: string,
  assignmentId: string,
  parcel: { id: string; code: string; name: string | null; cropType: CropType | null },
): Promise<void>;

async sendBalerFieldExitProduction(
  userId: string,
  assignmentId: string,
  parcel: { id: string; code: string; name: string | null },
): Promise<void>;
```

Other helpers added by Plan C (`sendTruckUnloadedLoaderPrompt`, `sendTruckIdleAdmin`) must coexist — keep alphabetical order in the file and avoid renaming existing private fields.

### 3.4 Sync allowlist

In `backend/service/src/sync/sync.service.ts`, `ALLOWED_COLUMNS.parcels` (line 173) currently lists 16 columns. Plan B adds `'crop_type'`. We do **not** remove `'is_active'` to preserve compatibility with mobile builds that may still read/write the column during the deprecation window.

---

## 4. Migrations

Two migrations: one Postgres (server) and one local SQLite additive.

### 4.1 Postgres migration — full SQL

**File:** `supabase/migrations/00042_parcel_crop_and_harvest_extended.sql`

```sql
-- ============================================================================
-- 00042_parcel_crop_and_harvest_extended.sql
--
-- T9.1: add crop_type enum + parcels.crop_type column.
-- T9.10 + T6 + T7: extend harvest_status enum with partial_harvested,
--                  in_loading, loaded, completed; add downgrade-prevention
--                  trigger so the ladder is monotonic.
-- T9.2 (partial): keep parcels.is_active column for one release but stop
--                 reading/writing from API. No DDL drop here.
--
-- Idempotent: safe to re-run. All ADD COLUMN / ADD VALUE / CREATE wrapped
-- in DO $$ ... EXCEPTION ... $$ or use IF NOT EXISTS.
-- ============================================================================

-- ── 1. crop_type enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE crop_type AS ENUM ('grau', 'orz', 'rapita', 'plante_nutret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. parcels.crop_type column (nullable, no default) ───────────────────────
--   Nullable so that admins are forced to set it explicitly per parcel;
--   missing-data dashboards can list parcels WHERE crop_type IS NULL.
DO $$ BEGIN
  ALTER TABLE parcels ADD COLUMN crop_type crop_type;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 3. harvest_status enum extensions ────────────────────────────────────────
--   ALTER TYPE ... ADD VALUE is NON-TRANSACTIONAL in older Postgres (<12).
--   ADD VALUE IF NOT EXISTS is supported since 9.6; Supabase ships 15+.
--   The new values are inserted AFTER 'harvested' so default ordering
--   (text comparison) does not matter — we use enum_range() and a CHECK
--   trigger to enforce the ladder, not ordinal position.
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'partial_harvested';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'in_loading';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'loaded';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'completed';

-- ── 4. Ladder helper function ────────────────────────────────────────────────
--   Maps each harvest_status to an integer rank for monotonic comparison.
--   T7: 'harvested' (4) > 'partial_harvested' (3) so partial -> harvested OK,
--       but harvested -> partial_harvested is blocked by the trigger below.
CREATE OR REPLACE FUNCTION harvest_status_rank(s harvest_status)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE s
    WHEN 'planned'           THEN 0
    WHEN 'to_harvest'        THEN 1
    WHEN 'harvesting'        THEN 2
    WHEN 'partial_harvested' THEN 3
    WHEN 'harvested'         THEN 4
    WHEN 'in_loading'        THEN 5
    WHEN 'loaded'            THEN 6
    WHEN 'completed'         THEN 7
  END
$$;

-- ── 5. Downgrade-prevention trigger ──────────────────────────────────────────
--   Raises if a row's harvest_status would move backward on the ladder.
--   Allows equal -> equal (no-op updates) and any forward jump.
--   Admins with a privileged session can bypass by setting the local GUC
--   `app.allow_harvest_downgrade = 'on'` (used by data-fix scripts only).
CREATE OR REPLACE FUNCTION prevent_harvest_status_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_bypass TEXT;
BEGIN
  IF NEW.harvest_status IS NULL OR OLD.harvest_status IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.harvest_status = OLD.harvest_status THEN
    RETURN NEW;
  END IF;

  -- Optional bypass for emergency data fixes
  v_bypass := current_setting('app.allow_harvest_downgrade', true);
  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  IF harvest_status_rank(NEW.harvest_status) < harvest_status_rank(OLD.harvest_status) THEN
    RAISE EXCEPTION
      'harvest_status downgrade blocked: % (rank %) -> % (rank %) on parcel %',
      OLD.harvest_status, harvest_status_rank(OLD.harvest_status),
      NEW.harvest_status, harvest_status_rank(NEW.harvest_status),
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_harvest_status_downgrade ON parcels;
CREATE TRIGGER trg_prevent_harvest_status_downgrade
  BEFORE UPDATE OF harvest_status ON parcels
  FOR EACH ROW
  EXECUTE FUNCTION prevent_harvest_status_downgrade();

-- ── 6. Indexes ───────────────────────────────────────────────────────────────
--   Partial index on crop_type for "filter by crop" admin queries.
CREATE INDEX IF NOT EXISTS idx_parcels_crop_type
  ON parcels (crop_type)
  WHERE deleted_at IS NULL AND crop_type IS NOT NULL;

--   Partial index on harvest_status for map / dashboard lookups.
CREATE INDEX IF NOT EXISTS idx_parcels_harvest_status
  ON parcels (harvest_status)
  WHERE deleted_at IS NULL;

-- ── 7. sync_version bump on harvest_status / crop_type updates ───────────────
--   00040 already adds a global trigger for sync_version on parcels updates,
--   so column-touching here is enough to surface deltas to clients.
--   Verified: 00040_global_sync_version.sql bumps on UPDATE OF * for parcels.

-- ── 8. RLS verification ──────────────────────────────────────────────────────
--   RLS on parcels already provisioned in 00008_rls_policies.sql.
--   No policy change needed — new column inherits row-level scope.

-- ── 9. Backfill (no-op) ──────────────────────────────────────────────────────
--   crop_type left NULL on existing rows; admin will fill in via UI.
--   Existing rows with harvest_status = 'harvested' remain valid; the
--   downgrade trigger now protects them.

-- ── 10. Comment metadata ────────────────────────────────────────────────────
COMMENT ON COLUMN parcels.crop_type IS 'T9.1 — wheat/barley/rapeseed/forage. NULL = not yet set.';
COMMENT ON TYPE  harvest_status IS 'T9.10 — extended ladder enforced by trg_prevent_harvest_status_downgrade.';
```

#### Notes for the executing agent

- **Two-statement gotcha.** `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as a query that *uses* that new value (Postgres restriction). Migrations in this repo run via `./strawboss.sh db:migrate` which executes each file in its own `psql -1`; we split nothing here because nothing in this file references the new values directly. The trigger function uses them via `CASE` which is allowed because the function body is not compiled until first invocation.
- **`enum_range` order.** New values land at the *end* of `pg_enum.oid` order. Anything that sorts `harvest_status` enum values directly (e.g. `ORDER BY harvest_status`) will now produce `planned, to_harvest, harvesting, harvested, partial_harvested, in_loading, loaded, completed` — which is *not* the logical ladder. Use `harvest_status_rank()` for any UI-facing ordering.
- **Downgrade bypass.** A privileged session must run `SET LOCAL app.allow_harvest_downgrade = 'on';` before issuing the fix UPDATE — kept off the `BEGIN` boundary to avoid leaking.
- **Migration numbering.** Last existing migration is `00041_user_signature_specimen.sql`, so this slot (00042) is unused. Verify with `ls supabase/migrations/`.

### 4.2 Mobile SQLite migration (additive)

In `apps/mobile/src/db/migrations.ts`, after the existing `addColumnIfMissing(...)` block:

```ts
// T9.1 — local parcel cache mirrors crop_type for offline map labels.
await addColumnIfMissing(db, 'parcels', 'crop_type', 'TEXT');
```

`apps/mobile/src/db/schema.ts` — update the `parcels` CREATE TABLE string to include the column for fresh installs:

```ts
parcels: `CREATE TABLE IF NOT EXISTS parcels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  area_hectares REAL,
  municipality TEXT,
  harvest_status TEXT,
  crop_type TEXT,
  centroid_json TEXT,
  geometry TEXT,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
```

No SQLite enum exists — `harvest_status` already stored as TEXT, so new server values flow through with no schema change.

---

## 5. Type / validation changes

### 5.1 `packages/types/src/entities/parcel.ts`

```ts
import type { Timestamps, SoftDelete, GeoPoint } from "../common.js";

/** @deprecated T9.2 — kept for one release for older clients. Do not surface in UI. */
export enum ParcelStatus {
  active = "active",
  inactive = "inactive",
}

/** Crop type for the parcel — T9.1. Nullable on storage; UI must handle null. */
export enum CropType {
  grau = "grau",
  orz = "orz",
  rapita = "rapita",
  plante_nutret = "plante_nutret",
}

/** Field harvest / work phase (map + parcels table; advanced by geofence + trip lifecycle). */
export enum HarvestStatus {
  planned = "planned",
  to_harvest = "to_harvest",
  harvesting = "harvesting",
  partial_harvested = "partial_harvested",
  harvested = "harvested",
  in_loading = "in_loading",
  loaded = "loaded",
  completed = "completed",
}

export interface Parcel extends Timestamps, SoftDelete {
  id: string;
  code: string;
  /** @deprecated T9.3 — kept in DB and on the wire; admin UI no longer shows it. Mobile displays `code` instead. */
  name: string;
  areaHectares: number;
  boundary: string | null;
  centroid: GeoPoint | null;
  address: string;
  municipality: string;
  farmtrackGeofenceId: string | null;
  farmId: string | null;
  notes: string | null;
  /** @deprecated T9.2 — server still returns true; not surfaced in UI. */
  isActive: boolean;
  harvestStatus: HarvestStatus;
  cropType: CropType | null;
}
```

### 5.2 `packages/validation/src/schemas/parcel.schema.ts`

```ts
import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { geoPointSchema } from "../helpers/geo.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const harvestStatusSchema = z.enum([
  "planned",
  "to_harvest",
  "harvesting",
  "partial_harvested",
  "harvested",
  "in_loading",
  "loaded",
  "completed",
]);

export const cropTypeSchema = z.enum(["grau", "orz", "rapita", "plante_nutret"]);

export const parcelSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    harvestStatus: harvestStatusSchema,
    farmId: z.string().uuid().nullable(),
    cropType: cropTypeSchema.nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createParcelSchema = z.object({
  code:                z.string().min(1).optional(),
  name:                z.string().min(1).optional(),
  areaHectares:        z.number().positive().optional(),
  boundary:            z.string().nullable().optional(),
  centroid:            geoPointSchema.nullable().optional(),
  address:             z.string().optional(),
  municipality:        z.string().optional(),
  farmtrackGeofenceId: z.string().nullable().optional(),
  notes:               z.string().nullable().optional(),
  harvestStatus:       harvestStatusSchema.optional(),
  cropType:            cropTypeSchema.nullable().optional(),
  farmId:              z.string().uuid().nullable().optional(),
});

export const updateParcelSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),                  // accepted but UI no longer surfaces
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    farmId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),                    // accepted but ignored server-side
    harvestStatus: harvestStatusSchema,
    cropType: cropTypeSchema.nullable(),
  })
  .partial();
```

### 5.3 `packages/validation/src/index.ts`

Add the new export:

```ts
export {
  parcelSchema,
  harvestStatusSchema,
  cropTypeSchema,
  createParcelSchema,
  updateParcelSchema,
} from "./schemas/parcel.schema.js";
```

---

## 6. Backend changes

### 6.1 `backend/service/src/parcels/parcels.service.ts`

1. Add `cropType` to all SELECT projections (`list`, `findById`) and to INSERT/UPDATE column maps:
   - SELECT alias: `crop_type AS "cropType"`
   - INSERT: append `crop_type` to the column list and `${cropType}::crop_type` to VALUES.
   - UPDATE fieldMap: add `cropType: 'crop_type'` and handle the cast like `harvestStatus`:
     ```ts
     if ('cropType' in dto) {
       const v = dto.cropType;
       setClauses.push(
         v == null
           ? sql`crop_type = NULL`
           : sql`crop_type = ${v as string}::crop_type`,
       );
     }
     ```
2. `list()` — drop `filters.isActive` reading. Still accept the filter param for backward compatibility but ignore it (or leave it; harmless since `is_active` is always TRUE going forward).
3. `applyHarvestStatusFromDailyPlan()` — keep existing behaviour but wrap the UPDATE in a try/catch on Postgres error code `23514` (check_violation) and log a warning instead of crashing if a downgrade attempt happens through daily-plan reconciliation.
4. **NEW** `advanceHarvestOnLoadEvent()` — implementation:
   ```ts
   async advanceHarvestOnLoadEvent(
     parcelId: string,
     event: HarvestLoadEvent,
     orgId: string | null,
   ): Promise<{ updated: boolean; fromStatus: HarvestStatus; toStatus: HarvestStatus }> {
     const targetMap: Record<HarvestLoadEvent, HarvestStatus> = {
       loading_started: HarvestStatus.in_loading,
       all_loaded:      HarvestStatus.loaded,
       all_delivered:   HarvestStatus.completed,
     };
     const target = targetMap[event];

     const current = await this.findById(parcelId, orgId);
     const from = current.harvestStatus as HarvestStatus;

     // No-op if target rank <= current rank
     const rankRow = (await this.drizzleProvider.db.execute(sql`
       SELECT harvest_status_rank(${from}::harvest_status)   AS "fromRank",
              harvest_status_rank(${target}::harvest_status) AS "toRank"
     `)) as unknown as Array<{ fromRank: number; toRank: number }>;
     if (rankRow[0].toRank <= rankRow[0].fromRank) {
       return { updated: false, fromStatus: from, toStatus: from };
     }

     const conds: ReturnType<typeof sql>[] = [
       sql`id = ${parcelId}::uuid`,
       sql`deleted_at IS NULL`,
     ];
     if (orgId !== null) conds.push(sql`organization_id = ${orgId}::uuid`);
     const where = sql.join(conds, sql` AND `);

     await this.drizzleProvider.db.execute(sql`
       UPDATE parcels
       SET harvest_status = ${target}::harvest_status, updated_at = NOW()
       WHERE ${where}
     `);

     this.winston.log('flow', 'parcels.harvest.advance', {
       context: 'ParcelsService',
       parcelId, event, fromStatus: from, toStatus: target,
     });

     return { updated: true, fromStatus: from, toStatus: target };
   }
   ```

### 6.2 `backend/service/src/parcels/parcels.controller.ts`

- Drop the `isActive` query string from `list` (or accept and ignore). Leaves the route signature stable for older clients.
- No new endpoint — Plan C calls `advanceHarvestOnLoadEvent` via DI, not HTTP.

### 6.3 `backend/service/src/geofence/geofence.service.ts`

Two changes in the ENTER block (around line 184–197):

1. Always include the new fields in the push payload regardless of machineType:
   ```ts
   await this.notificationsService.sendBalerFieldEntryConfirm(
     assignment.assignedUserId,
     assignment.assignmentId,
     {
       id: assignment.parcelId!,
       code: parcelCodeFromQuery,       // add p.code to the SELECT (currently only p.name)
       name: assignment.parcelName,
       cropType: parcelCropTypeFromQuery, // add p.crop_type to the SELECT
     },
   );
   ```
   *Important:* gate on `machineType === 'baler'`. For other machine types, keep the existing `sendPush('Ai intrat pe câmp', ...)` behaviour — we are not regressing T6 for loaders/drivers.

2. Do **not** auto-set the assignment to `in_progress` when a baler enters (the 10 s confirm POST will do that). For non-baler machines, keep the existing auto-transition.

   ```ts
   if (assignment.status === 'available' && assignment.machineType !== 'baler') {
     /* existing UPDATE task_assignments ... */
   }
   ```

3. Add `p.code AS "parcelCode"` and `p.crop_type AS "parcelCropType"` to the `assignmentsResult` SELECT at the top of `checkMachinePositions`. Extend `ActiveAssignment` interface.

EXIT block (line 252–264): switch baler branch to call the new helper:

```ts
if (
  geofenceType === 'parcel' &&
  assignment.machineType === 'baler' &&
  assignment.assignedUserId
) {
  await this.notificationsService.sendBalerFieldExitProduction(
    assignment.assignedUserId,
    assignment.assignmentId,
    {
      id: assignment.parcelId!,
      code: assignment.parcelCode ?? '???',
      name: assignment.parcelName,
    },
  );
}
```

### 6.4 `backend/service/src/notifications/notifications.service.ts`

Add the two helpers near the bottom of the class:

```ts
/** T6 enter: 10 s auto-confirm popup. Custom channel + loud sound. */
async sendBalerFieldEntryConfirm(
  userId: string,
  assignmentId: string,
  parcel: { id: string; code: string; name: string | null; cropType: string | null },
): Promise<void> {
  await this.sendPush(
    userId,
    'Începi balotarea?',
    `Parcela ${parcel.code} — ${parcel.cropType ?? 'cultură necunoscută'}. ` +
      `Confirmare automată în 10 s.`,
    {
      type: 'field_entry_confirm',
      assignmentId,
      parcelId: parcel.id,
      parcelCode: parcel.code,
      parcelName: parcel.name,
      cropType: parcel.cropType,
    },
  );
}

/** T6 exit: loud horn + production-entry CTA. */
async sendBalerFieldExitProduction(
  userId: string,
  assignmentId: string,
  parcel: { id: string; code: string; name: string | null },
): Promise<void> {
  await this.sendPush(
    userId,
    'Ai ieșit din parcelă',
    `Introdu numărul de baloți pentru ${parcel.code}.`,
    {
      type: 'field_exit_production',
      assignmentId,
      parcelId: parcel.id,
      parcelCode: parcel.code,
      parcelName: parcel.name,
      // Hint to mobile to use the `baler-exit` notification channel
      _channelId: 'baler-exit',
    },
  );
}
```

`sendPush` already forwards `data` verbatim; the mobile push handler reads `_channelId` to route the notification through the channel registered in app.json.

### 6.5 `backend/service/src/notifications/notifications.controller.ts`

Extend `confirm-parcel-done`:

```ts
const confirmParcelDoneSchema = z.object({
  assignmentId: z.string().uuid(),
  baleCount: z.number().int().min(0).max(9999).optional(),
  finishState: z.enum(['partial', 'total']).optional(),
});

@Post('confirm-parcel-done')
@Roles('admin' as UserRole, 'baler_operator' as UserRole)
async confirmParcelDone(
  @CurrentUser() user: RequestUser,
  @Body(new ZodValidationPipe(confirmParcelDoneSchema))
  body: { assignmentId: string; baleCount?: number; finishState?: 'partial' | 'total' },
) {
  await this.notificationsService.confirmParcelDone(
    body.assignmentId,
    body.baleCount,
    body.finishState ?? 'total', // default keeps legacy clients working
    user.id,
    user.organizationId,
  );
  return { ok: true };
}
```

Then in `notifications.service.ts` change `confirmParcelDone` to accept `finishState` and map it to a harvest status:

```ts
const harvestTarget = finishState === 'partial'
  ? 'partial_harvested'
  : 'harvested';

await this.drizzleProvider.db.execute(sql`
  UPDATE parcels
  SET harvest_status = ${harvestTarget}::harvest_status,
      updated_at = now()
  WHERE id = (SELECT parcel_id FROM task_assignments WHERE id = ${assignmentId}::uuid)
    AND deleted_at IS NULL
`);
```

The downgrade trigger ensures partial cannot overwrite a later state — confirm with a try/catch and surface as 409.

Add a new endpoint `POST /notifications/confirm-parcel-entry`:

```ts
@Post('confirm-parcel-entry')
@Roles('admin' as UserRole, 'baler_operator' as UserRole)
async confirmParcelEntry(
  @CurrentUser() user: RequestUser,
  @Body() body: { assignmentId: string },
) {
  if (!body.assignmentId) throw new BadRequestException('assignmentId required');
  await this.notificationsService.confirmParcelEntry(
    body.assignmentId, user.id, user.organizationId,
  );
  return { ok: true };
}
```

Service helper `confirmParcelEntry` runs:
1. Verify ownership (same pattern as `confirmParcelDone`).
2. `UPDATE task_assignments SET status = 'in_progress', actual_start = now(), updated_at = now() WHERE id = $1 AND status = 'available'` (optimistic — no-op if already in progress).
3. `UPDATE parcels SET harvest_status = 'harvesting' WHERE id = (SELECT parcel_id ...)` — trigger blocks downgrades automatically.
4. Winston flow log `parcels.harvest.entry_confirmed`.

### 6.6 `backend/service/src/sync/sync.service.ts`

Add `'crop_type'` to the `parcels` set (line 173):

```ts
parcels: new Set([
  'id', 'code', 'name', 'owner_name', 'owner_contact',
  'area_hectares', 'boundary', 'centroid', 'address', 'municipality',
  'notes', 'is_active', 'harvest_status',
  'crop_type',                                       // ← new
  'farmtrack_geofence_id', 'farm_id', 'sync_version',
]),
```

Also extend the explicit column projection on line ~570 (the parcels SELECT in pull) to include `crop_type AS "cropType"` so mobile can cache it.

---

## 7. Admin web changes

### 7.1 `apps/admin-web/src/app/[slug]/(dashboard)/parcels/page.tsx`

#### Form modal
- **Remove** the `name` input (lines 154–167). Keep `name` in payload only when editing an existing parcel (preserve current value so we do not overwrite to empty).
- **Remove** the `Active toggle` block (lines 261–274) and the `isActive` state.
- **Add** `cropType` state and a new `<select>` placed under `harvestStatus`:
  ```tsx
  <div>
    <label className="block text-xs font-medium text-neutral-600 mb-1">
      {t('parcels.form.cropType')}
    </label>
    <select
      value={cropType ?? ''}
      onChange={(e) => setCropType((e.target.value || null) as CropType | null)}
      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ..."
    >
      <option value="">{t('parcels.form.cropTypeNone')}</option>
      {CROP_TYPE_OPTIONS.map((v) => (
        <option key={v} value={v}>{t(`parcels.crop.${v}`)}</option>
      ))}
    </select>
  </div>
  ```
- The submit handler validation now requires nothing — `code` is auto-generated and `name` is not surfaced.

#### Table
- Drop the `colName` column and the `colStatus` (is_active) column.
- Add a `colCrop` column rendering `t('parcels.crop.' + p.cropType)` or `—` if null.
- Render `code` as the primary identifier in the first column (already done; keep the chip).
- For the `harvestStatus` column use the new `<HarvestStatusBadge>` component.

#### Filters
- Remove `statusFilter` (active/inactive) entirely.
- Add `cropFilter`:
  ```tsx
  <select value={cropFilter} ...>
    <option value="">{t('parcels.filterAllCrops')}</option>
    {CROP_TYPE_OPTIONS.map((v) => (
      <option key={v} value={v}>{t(`parcels.crop.${v}`)}</option>
    ))}
  </select>
  ```

#### Stats
- Replace the "Active" stat with "Cu cultură setată" (count where `cropType != null`).

### 7.2 `apps/admin-web/src/components/shared/StatusBadge.tsx`

Create a sibling component (same file or `HarvestStatusBadge.tsx` — preference: sibling file to avoid mixing trip + harvest enums). Trip styles untouched.

```tsx
// apps/admin-web/src/components/shared/HarvestStatusBadge.tsx
'use client';
import { HarvestStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const harvestStyles: Record<HarvestStatus, string> = {
  [HarvestStatus.planned]:           'bg-neutral-100 text-neutral-700',
  [HarvestStatus.to_harvest]:        'bg-amber-50 text-amber-800',
  [HarvestStatus.harvesting]:        'bg-amber-200 text-amber-900',
  [HarvestStatus.partial_harvested]: 'bg-orange-100 text-orange-800',
  [HarvestStatus.harvested]:         'bg-yellow-100 text-yellow-800',
  [HarvestStatus.in_loading]:        'bg-sky-100 text-sky-800',
  [HarvestStatus.loaded]:            'bg-blue-100 text-blue-800',
  [HarvestStatus.completed]:         'bg-emerald-100 text-emerald-800',
};

export function HarvestStatusBadge({ status, className }: { status: HarvestStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', harvestStyles[status], className)}>
      {t(`parcels.harvest.${status}`)}
    </span>
  );
}
```

### 7.3 i18n — `apps/admin-web/messages/ro.json`

Extend the `parcels` namespace:

```json
"parcels": {
  ...
  "harvest": {
    "planned": "Planificat",
    "to_harvest": "De recoltat",
    "harvesting": "În recoltă",
    "partial_harvested": "Parțial recoltat",
    "harvested": "Recoltat",
    "in_loading": "În încărcare",
    "loaded": "Încărcat",
    "completed": "Finalizat"
  },
  "crop": {
    "grau": "Grâu",
    "orz": "Orz",
    "rapita": "Rapiță",
    "plante_nutret": "Plante de nutreț"
  },
  "filterAllCrops": "Toate culturile",
  "colCrop": "Cultură",
  "form": {
    ...
    "cropType": "Tip cultură",
    "cropTypeNone": "— Necunoscută —"
  }
}
```

### 7.4 i18n — `apps/admin-web/messages/en.json`

Mirror with English. Translations:
- `grau` → "Wheat", `orz` → "Barley", `rapita` → "Rapeseed", `plante_nutret` → "Forage crops".
- Harvest: `partial_harvested` → "Partially harvested", `in_loading` → "Loading", `loaded` → "Loaded", `completed` → "Completed".

---

## 8. Mobile changes

### 8.1 T5 — Baler home parcel tap → parcel detail

- `apps/mobile/app/(baler)/index.tsx`: keep existing layout, but render `<TaskList tasks={tasks} role="baler_operator" onTaskPress={handleBalerTaskPress} />` where:
  ```ts
  const handleBalerTaskPress = (task: MyTask) => {
    if (task.parcelId) router.push(`/(baler)/parcel/${task.parcelId}`);
    else router.push(`/(baler)/map?focusId=${task.destinationId ?? ''}`);
  };
  ```
- `apps/mobile/src/components/shared/TaskList.tsx`: add optional prop `onTaskPress?: (task: MyTask) => void`. When provided, use it; otherwise use existing `handlePress` logic. **Do not change behavior for loader/driver** — they pass no override.

- **New file** `apps/mobile/app/(baler)/parcel/[parcelId].tsx`:
  - Pull parcel from local SQLite (`parcels` table) first, fall back to `useParcel(parcelId)` API hook.
  - Render header (parcel `code`, large), area in ha, crop type label, harvest status badge, municipality + address, notes, current bale availability (`produced`, `loaded`, `remaining` via `useParcelBaleAvailability`).
  - Action: "Înregistrează producție" → routes to `(baler)/production` with parcel preselected via store / param.
  - Use the existing `ScreenHeader` + `BigButton` for visual consistency.

### 8.2 T6 — Geofence entry (10 s auto-confirm)

#### `useGeofenceNotifications.ts`

Extend `GeofenceAlert`:
```ts
export interface GeofenceAlert {
  type: 'field_entry' | 'entry_confirm' | 'exit_confirm' | 'deposit_entry' | 'exit_production';
  parcelName: string;
  parcelCode?: string;
  parcelId?: string;
  cropType?: string | null;
  assignmentId: string;
  tripId?: string | null;
}
```

Add a new alert type from the push:
```ts
case 'field_entry_confirm':
  setAlertQueue((q) => [
    ...q,
    {
      type: 'entry_confirm',
      parcelName: data.parcelName ?? 'Câmp',
      parcelCode: data.parcelCode,
      parcelId: data.parcelId,
      cropType: data.cropType ?? null,
      assignmentId,
    },
  ]);
  break;
case 'field_exit_production':
  // Force-route to the production entry screen (mounted in baler-ops).
  router.push({
    pathname: '/baler-ops/production-entry',
    params: { assignmentId, parcelCode: data.parcelCode ?? '', parcelId: data.parcelId ?? '' },
  });
  return;
```

Add API methods:
```ts
const confirmParcelEntry = useCallback(async (assignmentId: string) => {
  await mobileApiClient.post('/api/v1/notifications/confirm-parcel-entry', { assignmentId });
  setAlertQueue((q) => q.slice(1));
}, []);

const cancelParcelEntry = useCallback(() => {
  setAlertQueue((q) => q.slice(1));
  mobileLogger.flow('Geofence: baler entry cancelled by user', {});
}, []);
```

Return them from the hook.

#### `GeofenceOverlay.tsx`

Add a new branch:

```tsx
if (alert.type === 'entry_confirm') {
  return (
    <EntryConfirmCountdown
      timeoutMs={10_000}
      parcelCode={alert.parcelCode ?? alert.parcelName}
      cropType={alert.cropType ?? null}
      onConfirm={() => onConfirmParcelEntry(alert.assignmentId)}
      onCancel={onCancelParcelEntry}
    />
  );
}
```

#### New component `EntryConfirmCountdown`

Co-located in `src/components/features/production/BalerEntryCountdown.tsx`. Wraps the existing `ConfirmCountdown` (3 s default) by passing `countdownSeconds={10}` and customizing the label:

```ts
export interface EntryConfirmCountdownProps {
  /** Total countdown in ms (default 10 000). */
  timeoutMs?: number;
  parcelCode: string;
  cropType: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EntryConfirmCountdown({
  timeoutMs = 10_000,
  parcelCode,
  cropType,
  onConfirm,
  onCancel,
}: EntryConfirmCountdownProps) {
  const seconds = Math.round(timeoutMs / 1000);
  const label = `Începi balotarea în ${parcelCode}` + (cropType ? ` (${CROP_LABELS[cropType] ?? cropType})` : '');
  return (
    <ConfirmCountdown
      visible
      actionLabel={label}
      countdownSeconds={seconds}
      onConfirmed={onConfirm}
      onCancel={onCancel}
    />
  );
}
```

`CROP_LABELS` is a local RO map: `{ grau: 'Grâu', orz: 'Orz', rapita: 'Rapiță', plante_nutret: 'Plante de nutreț' }`.

### 8.3 T6 — Geofence exit (loud sound + production entry)

#### Sound playback strategy

**Decision:** Use Android notification channel with custom sound for the **push** itself (works even if app is backgrounded), and `expo-av` for an additional in-app horn when the screen mounts (foreground).

- **Asset:** `apps/mobile/assets/sounds/baler-exit.wav` — short (~1 s) royalty-free horn. Must be PCM 16-bit, 44.1 kHz, mono so Android can play it via the notification channel without conversion.
- **Channel registration** in `app.json` (Expo plugin `expo-notifications`):
  ```json
  {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#0A5C36",
          "sounds": ["./assets/sounds/baler-exit.wav"]
        }
      ]
    ]
  }
  ```
- **Programmatic channel** (must run at app boot, e.g. in `app/_layout.tsx`):
  ```ts
  await Notifications.setNotificationChannelAsync('baler-exit', {
    name: 'Alertă ieșire câmp',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'baler-exit.wav',
    vibrationPattern: [0, 400, 200, 400],
    bypassDnd: true,
  });
  ```
  We do this guarded by `Platform.OS === 'android'`.
- **iOS:** custom critical sounds require an entitlement we do not have; iOS falls back to default sound + extra haptic.

#### `production-entry.tsx` (new screen)

`apps/mobile/app/baler-ops/production-entry.tsx`:

```tsx
export default function ProductionEntryScreen() {
  const { assignmentId, parcelCode, parcelId } = useLocalSearchParams<{
    assignmentId: string; parcelCode: string; parcelId: string;
  }>();
  const [count, setCount] = useState('');
  const [finish, setFinish] = useState<'partial' | 'total' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Loud horn on mount (foreground reinforcement)
    if (Platform.OS === 'android') {
      const { sound } = await Audio.Sound.createAsync(require('@/../assets/sounds/baler-exit.wav'));
      await sound.playAsync();
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const handleSubmit = async () => {
    if (!finish) return; // disabled state until user picks
    setSaving(true);
    try {
      await mobileApiClient.post('/api/v1/notifications/confirm-parcel-done', {
        assignmentId,
        baleCount: parseInt(count, 10) || 0,
        finishState: finish,
      });
      router.replace('/(baler)');
    } catch (err) {
      // Queue for retry via sync queue (existing pattern)
    } finally {
      setSaving(false);
    }
  };

  return (
    <View ...>
      <ScreenHeader title={`Producție — ${parcelCode}`} />
      <NumericPad value={count} onChange={setCount} maxLength={4} />
      <HarvestFinishPicker value={finish} onChange={setFinish} />
      <BigButton title="Trimite" onPress={handleSubmit} disabled={!finish || saving} />
    </View>
  );
}
```

#### `HarvestFinishPicker` (new component)

`apps/mobile/src/components/features/production/HarvestFinishPicker.tsx`:

```ts
export interface HarvestFinishPickerProps {
  value: 'partial' | 'total' | null;
  onChange: (v: 'partial' | 'total') => void;
}
```

Renders two big buttons stacked vertically:
- "Parțial finalizată" (orange `#EA580C`, icon `progress-clock`)
- "Total finalizată" (green `#0A5C36`, icon `check-circle`)
The selected button gets a 3 px border + filled background.

### 8.4 T7 — UI enforcement of ladder

In the harvest dropdown anywhere in mobile (currently none; admin only), the dropdown options must be filtered by current rank:

```ts
const RANK: Record<HarvestStatus, number> = {
  planned: 0, to_harvest: 1, harvesting: 2,
  partial_harvested: 3, harvested: 4,
  in_loading: 5, loaded: 6, completed: 7,
};
const allowed = (current: HarvestStatus) =>
  Object.keys(RANK).filter(s => RANK[s] >= RANK[current]) as HarvestStatus[];
```

Apply in `apps/admin-web/src/app/[slug]/(dashboard)/parcels/page.tsx` form modal — when editing, filter the dropdown options. Show greyed-out disabled options for ranks below current so the operator understands the constraint.

### 8.5 T9.1 — Crop type display

- Mobile parcel detail (T5 screen): show crop type label below the parcel code with a small `Wheat` icon.
- `apps/mobile/src/components/shared/ParcelSelector.tsx` (read-only addition): if the parcel has a `cropType`, render it as a subtitle.

### 8.6 T9.2 — Remove `is_active` UI

- Admin parcels page: drop the active toggle and filter (done in 7.1).
- Mobile: no usage of `is_active` in UI surfaces — search confirms only `useActiveParcels` hook uses it server-side, but the hook reads `deleted_at IS NULL` already.

### 8.7 T9.3 — Display name = code

- Admin: drop the name column from the table; drop the input from the form.
- Mobile: `TaskList.getTaskLabel` already falls back to `parcelCode` — bump it so for `role === 'baler_operator'` the **code** is preferred over the `parcelName`. Add:
  ```ts
  const getTaskLabel = (task: MyTask): string => {
    if (role === 'baler_operator') {
      return task.parcelCode ?? task.parcelName ?? `Sarcina #${task.sequenceOrder}`;
    }
    /* existing branches */
  };
  ```

---

## 9. Per-task deep dive

### T5 — Tap parcel on baler home → parcel detail

**Problem.** `apps/mobile/app/(baler)/index.tsx:53` renders `<TaskList tasks={tasks} role="baler_operator" />`. `TaskList.handlePress` always routes to `/(baler)/map?focusId=...` (TaskList.tsx:60–62), so the user lands on the map, not on the parcel detail.

**Target state.** Baler taps a task card → opens a new screen `/(baler)/parcel/[parcelId]` showing parcel info + actions. Loader/driver behavior unchanged.

**Steps.**
1. Add optional `onTaskPress` prop on `TaskList`. Default to current behavior.
2. Pass `onTaskPress={(t) => router.push('/(baler)/parcel/' + t.parcelId)}` from `(baler)/index.tsx`. Fall back to map if no parcel (destination-only tasks).
3. Create `app/(baler)/parcel/[parcelId].tsx`. Use the existing `useParcels(apiClient)` hook from `@strawboss/api` + filter, or add `useParcel(id)` if a single-fetch hook does not exist (check `packages/api/src/hooks/`). On loading fallback to local SQLite parcel cache (`SELECT * FROM parcels WHERE id = ?`).
4. Render: parcel code (large), area, crop, harvest status, address, notes, bale availability stats, action buttons ("Înregistrează producție", "Deschide pe hartă").
5. Verify on Android device that back navigation returns to home.

**Edge cases.**
- Parcel not in local cache yet and offline → render skeleton + retry button.
- `parcelId` invalid / parcel deleted → show "Câmpul a fost șters" + back button.

**Acceptance.**
- Tap on a task with `parcelId` → opens detail screen.
- Tap on a task without `parcelId` (destination-only) → still opens map (legacy behavior preserved).
- Loader / driver home screens still route to map on tap (no regression).

**Effort.** S (3–4 h).

---

### T6 — Geofence enter/exit UX (THE BIG ONE)

**Problem.** Today `GeofenceService` ENTER sends `field_entry` push (banner only, no confirmation). EXIT sends `geofence_exit_confirm` push that opens a generic NumericPad. No sound, no partial/total picker, no 10 s auto-confirm.

**Current state references.**
- `backend/service/src/geofence/geofence.service.ts:184–197` (enter push)
- `backend/service/src/geofence/geofence.service.ts:252–264` (exit push)
- `apps/mobile/src/components/shared/GeofenceOverlay.tsx:114–168` (exit modal)
- `apps/mobile/src/hooks/useGeofenceNotifications.ts:93–137`

**Target state.**

**Enter path:**
1. Server sends `field_entry_confirm` (not `field_entry`) for baler machines.
2. Mobile receives push; `useGeofenceNotifications` enqueues an `entry_confirm` alert.
3. `GeofenceOverlay` renders `<EntryConfirmCountdown timeoutMs={10000} ...>` over the active screen.
4. **On 10 s expiry** → calls `POST /notifications/confirm-parcel-entry` → server flips assignment → `in_progress` and parcel → `harvesting`.
5. **On cancel** → dismiss, no API call (assignment stays `available`).

**Exit path:**
1. Server sends `field_exit_production` for baler machines (with custom channel `baler-exit`).
2. Push lands; if app foreground, hook routes to `/baler-ops/production-entry`. If background, OS plays the loud horn from the channel; tapping opens the screen via deep link.
3. Production entry screen plays an additional in-app horn on mount (foreground reinforcement) and triggers haptics.
4. User enters bale count, picks Partial or Total, hits "Trimite".
5. `POST /notifications/confirm-parcel-done` with `{ assignmentId, baleCount, finishState }` → server sets harvest_status to `partial_harvested` or `harvested` and records bale production.

**Steps.**
1. Backend changes (§6.3, §6.4, §6.5).
2. Add sound asset + register channel in `app.json` + `_layout.tsx` (§8.3 sound strategy).
3. Add new `EntryConfirmCountdown` and `HarvestFinishPicker` components.
4. Update `useGeofenceNotifications` for new payload types + new actions.
5. Update `GeofenceOverlay` to render the entry-confirm variant.
6. Add `app/baler-ops/production-entry.tsx`.
7. End-to-end test on an Android APK with the geofence simulator (server can post simulated pushes via `/notifications/simulate-push`).

**Edge cases.**
- App killed when geofence enter push arrives → tapping the notification opens the app and routes to `/baler-ops/production-entry` via deep link param read by `_layout.tsx`.
- 10 s countdown completes while user is on a different screen (Producție tab) → still fires; alert overlay is mounted at the tab-layout level, so it sits above any tab content.
- Push delivery delayed → assignment may not auto-flip to `in_progress` for several minutes. Acceptable; admin sees it as `available` until confirmation.
- Bale count is 0 → still allow submission (operator may report a fully-failed field).
- User declines both partial and total → button disabled, cannot submit. No silent destructive fallback.

**Acceptance.**
- On geofence enter, popup appears with countdown.
- Cancel within 10 s → no API call.
- Auto-confirm at 10 s → assignment in_progress, parcel harvesting.
- On geofence exit, screen opens, horn plays, partial/total selectable.
- Submit → parcel harvest_status updated per selection; trigger blocks downgrade if already at `harvested`.

**Effort.** L (~1.5 days).

---

### T7 — Harvest-status hierarchy enforcement

**Problem.** Today nothing prevents `harvested → partial_harvested` regression. Any update to `parcels.harvest_status` is accepted.

**Target.**
- DB trigger blocks downgrade (§4.1 §5).
- Backend `ParcelsService.update()` catches Postgres error code `23514`, throws `ConflictException` with message "Statusul recoltei nu poate fi retrogradat".
- Admin UI shows greyed-out disabled options below the current rank in the harvest dropdown.

**Acceptance.**
- DB-level: SQL `UPDATE parcels SET harvest_status = 'partial_harvested' WHERE harvest_status = 'harvested'` raises `check_violation`.
- API: PATCH with downgrade returns 409 with localized message.
- UI: dropdown disables backward options.

**Effort.** S (2–3 h).

---

### T9.1 — Crop type

Already covered above. Acceptance: admin can pick a crop on create/edit; mobile parcel detail (T5 screen) displays the crop label; new column on local SQLite parcels cache; sync allowlist updated; PostGIS / GIN unchanged.

---

### T9.2 — Remove `is_active` from UI

- Admin parcels form: no toggle.
- Admin parcels table: no Status column or filter.
- Backend: silently ignore `isActive` writes (column defaults to TRUE).
- DB column stays for one release to avoid breaking older mobile builds that still SELECT `is_active`.

**Acceptance.**
- Admin UI never shows the active/inactive concept.
- Pre-existing inactive parcels become visible again (acceptable per user requirement).
- If user wants to hide a parcel they soft-delete it.

---

### T9.3 — Display name = code

Already covered above. Acceptance: nowhere in mobile/admin UI is the parcel `name` shown; `code` is the sole identifier.

---

### T9.10 — Full harvest-status flow

State machine summary (server-enforced via trigger; client-side reads `harvest_status_rank` for ordering):

| From | Event | To | Triggered by |
|---|---|---|---|
| planned | (admin sets) | to_harvest | Admin manual |
| to_harvest | baler geofence ENTER + 10 s confirm | harvesting | T6 enter |
| harvesting | exit + Partial pick | partial_harvested | T6 exit |
| harvesting | exit + Total pick | harvested | T6 exit |
| partial_harvested | second baler visit + Total pick | harvested | T6 exit (re-entry) |
| harvested | first bale load row | in_loading | Plan C `advanceHarvestOnLoadEvent('loading_started')` |
| in_loading | last bale loaded (remaining = 0) | loaded | Plan C `advanceHarvestOnLoadEvent('all_loaded')` |
| loaded | all trips for parcel completed | completed | Plan C `advanceHarvestOnLoadEvent('all_delivered')` |

UI surfaces:
- Admin parcels table column (badge).
- Admin map labels (Plan A — automatic since they already render `harvestStatus`).
- Mobile baler home cards (badge under the parcel code).
- Mobile parcel detail screen.
- Mobile deposit inventory screen (Plan C T12 — they'll consume the new statuses).

**Acceptance.** Every parcel that goes through the lifecycle visibly transitions through the eight states. Each transition is logged in `winston flow`.

**Effort.** M — implementation tracked across T6 + backend helpers above.

---

## 10. Cross-cutting concerns

### 10.1 Sound playback

- Custom Android notification channel `baler-exit` with `expo-notifications` plugin (loud, importance MAX, vibration, bypass DND).
- In-app `expo-av` horn playback on screen mount for foreground reinforcement.
- iOS fallback: standard sound + warning haptic (no critical-sound entitlement).

### 10.2 Haptics

- 10 s countdown: light impact per tick (already in `ConfirmCountdown`).
- Exit production page: `NotificationFeedbackType.Warning` on mount.
- Partial/Total selection: `ImpactFeedbackStyle.Medium` on each tap.

### 10.3 Accessibility

- All new buttons have `accessibilityRole="button"` and Romanian `accessibilityLabel`.
- Countdown shows visible digit + announces remaining seconds via `accessibilityLiveRegion="polite"`.
- Color is never the sole carrier of state: badges include text labels in addition to color.

### 10.4 i18n keys (additive only)

- `parcels.harvest.{partial_harvested, in_loading, loaded, completed}` in both `ro.json` and `en.json`.
- `parcels.crop.{grau, orz, rapita, plante_nutret}` in both.
- `parcels.form.cropType`, `parcels.form.cropTypeNone`, `parcels.filterAllCrops`, `parcels.colCrop`.

Mobile uses RO-only literals (the rest of the app is RO-only) — no JSON file changes for mobile, only inline strings.

---

## 11. Verification checklist

### 11.1 Type / build

- `./strawboss.sh typecheck packages` — passes (types + validation + api).
- `./strawboss.sh typecheck backend` — passes.
- `./strawboss.sh typecheck admin` — passes.
- `pnpm --filter @strawboss/mobile typecheck` — passes.

### 11.2 Lint

- `./strawboss.sh lint` — passes.

### 11.3 Database

```bash
./strawboss.sh db:migrate
```

then verify:

```sql
-- enum values
SELECT unnest(enum_range(NULL::harvest_status));
SELECT unnest(enum_range(NULL::crop_type));

-- downgrade trigger
DO $$ BEGIN
  -- Should succeed
  UPDATE parcels SET harvest_status = 'partial_harvested' WHERE id = (SELECT id FROM parcels LIMIT 1);
  UPDATE parcels SET harvest_status = 'harvested' WHERE id = (SELECT id FROM parcels LIMIT 1);
  -- Should fail
  BEGIN
    UPDATE parcels SET harvest_status = 'partial_harvested' WHERE id = (SELECT id FROM parcels LIMIT 1);
    RAISE EXCEPTION 'EXPECTED downgrade to be blocked';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK — downgrade correctly blocked';
  END;
END $$;
```

### 11.4 Mobile manual flow

Build an APK (`./strawboss.sh mobile-build-local`), install on a real Android device, then:

1. Login as a baler operator with an assigned task today.
2. From home, tap a task → parcel detail opens (T5).
3. Use admin's `/notifications/simulate-push` with event `field_entry_confirm` to simulate a geofence enter → popup with 10 s countdown appears (T6 enter).
4. Cancel within 10 s → popup disappears, no server change.
5. Re-trigger and let the countdown finish → assignment goes `in_progress`, parcel `harvesting` (verify via admin).
6. Trigger `field_exit_production` push → horn plays even with screen off (T6 exit). Open production entry screen, enter bale count, pick Partial → submit → admin sees `partial_harvested`.
7. Trigger again, pick Total → admin sees `harvested`.
8. Have admin try to downgrade in the admin form → see 409 toast.

### 11.5 PR readiness

- All commits Conventional (`feat(parcels): ...`, `feat(geofence): ...`).
- PR description references the relevant tasks (T5/T6/T7/T9.*).
- `strawboss-bug-hunt` and `strawboss-review` skills run clean.

---

## 12. PR strategy

Single PR titled **"feat: baler harvest workflow + crop type + harvest ladder (Plan B)"**, base branch `main`, branch `feat/plan-b-baler-harvest`.

Recommended commit sequence (logical chunks):
1. `feat(db): add crop_type enum, extend harvest_status, downgrade trigger (00042)`
2. `feat(types,validation): CropType + extended HarvestStatus + cropType field`
3. `feat(backend/parcels): cropType, downgrade catch, advanceHarvestOnLoadEvent`
4. `feat(backend/geofence): baler enter sends confirm push, baler exit sends production push`
5. `feat(backend/notifications): sendBalerFieldEntryConfirm, sendBalerFieldExitProduction, /confirm-parcel-entry, finishState on /confirm-parcel-done`
6. `feat(backend/sync): allow crop_type in parcels sync`
7. `feat(admin/parcels): drop name + isActive UI, add crop dropdown, harvest badge`
8. `feat(mobile/baler): parcel detail screen + tap-from-home`
9. `feat(mobile/geofence): EntryConfirmCountdown + HarvestFinishPicker + production-entry screen + loud sound`
10. `chore: i18n keys for crop and extended harvest`
11. `chore(docs): refresh .claude/docs after Plan B` (run `/strawboss-sync-docs`)

Open the PR with this plan referenced in the body. Wait for `bug-scan.yml` to pass before requesting review.

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ALTER TYPE ... ADD VALUE` issued inside a wrapping transaction by `./strawboss.sh db:migrate` | Low | Migration fails | Migration uses `ADD VALUE IF NOT EXISTS` and the runner executes each file in its own `psql -1` (one transaction per file). The first statement after the ADD VALUE that *uses* the new enum value is in the trigger function body, which is parsed lazily — safe. If we ever need to USE a new value in the same file, split into two files. |
| Postgres enum sort order surprises (new values are appended to `pg_enum.oid`) | Medium | Reports / UI that ORDER BY enum column produce nonsensical order | Always sort via `harvest_status_rank(col)` server-side; never rely on enum implicit ordering. |
| Custom Android notification sound not playing (FCM credential issue) | Medium | Operator misses geofence exit | (1) Verify FCM credentials uploaded for the Expo project. (2) Foreground horn via `expo-av` is a redundant fallback that does not depend on FCM. (3) Vibration pattern still fires from the channel even if sound fails. |
| 10 s auto-confirm fires while user is mid-action on another screen (e.g. consumables form) | Medium | Unwanted assignment transition | Countdown is cancellable from the overlay; haptic per tick keeps the user aware. Server is idempotent — if `confirm-parcel-entry` is called twice the second is a no-op. |
| Partial vs total ambiguity for a parcel revisited multiple times in a day | Medium | Parcel stuck at `partial_harvested` despite being fully done | Each visit's exit re-opens production-entry; second visit picking Total flips to `harvested` (trigger allows since rank increases). Document this in the operator manual. |
| Plan C lands first and tries to call `advanceHarvestOnLoadEvent` before Plan B merges | High during interleaving | Build failure | Plan C's PR adds the call sites; we provide the helper in this PR. If Plan C's branch needs an early stub, they can shim a TODO helper locally — coordinated via Slack / PR comments. |
| Mobile build does not pick up the new sound asset | Low | Loud horn missing on prod APK | Add the sound file path to `app.json` plugins, confirm `pnpm brand:rasters` does not delete it (it does not — only icons), and run `eas build --profile preview` once before tagging. |
| Existing rows with `harvest_status = 'harvested'` get a new daily-plan toggle that tries to set them back to `to_harvest` | Medium | DB exception 23514 | `ParcelsService.applyHarvestStatusFromDailyPlan` wraps the UPDATE in try/catch and logs a winston `warn` line; the daily-plan UI shows a soft warning toast. |

---

*End of Plan B.*

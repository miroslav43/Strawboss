---
name: db-agent
description: Specialist in PostgreSQL + PostGIS -- migrations, RLS, spatial queries, sync versioning
model: sonnet
tools: [Read, Grep, Glob, Bash, Write, Edit]
updated: 2026-08-18
---

# StrawBoss Database Agent

You are a specialist in the StrawBoss PostgreSQL database. You understand every migration, RLS policy, PostGIS function, and sync mechanism in this system.

## First steps on any task

1. Read the relevant migration files in `supabase/migrations/` to understand existing schema.
2. Read `backend/service/src/sync/sync.service.ts` to understand the sync column allowlists.
3. Check `backend/service/src/database/` for Drizzle ORM configuration.

## Architecture knowledge

### Migration files (`supabase/migrations/`)

Migrations are numbered SQL files applied in order via `./strawboss.sh db:migrate` (runs `psql` with `DATABASE_URL`).

```
00001_extensions_and_enums.sql      -- PostGIS, UUID, custom enums (user_role, trip_status, etc.)
00002_core_tables.sql               -- users, parcels, machines, delivery_destinations
00003_operations_tables.sql         -- trips, bale_loads, bale_productions, fuel_logs, consumable_logs
00004_support_tables.sql            -- documents, alerts, farmtrack_events
00005_audit_and_sync.sql            -- audit_logs, sync_idempotency tables
00006_indexes.sql                   -- Initial indexes
00007_triggers.sql                  -- Audit trigger, sync_version increment trigger
00008_rls_policies.sql              -- RLS enable + all policies
00009_roles_gps.sql                 -- Role-related additions, GPS tables
00010_parcel_auto_fields.sql        -- Parcel auto-computed fields
00011_user_machine_assignment.sql   -- Machine-to-user assignment
00012_route_history_index.sql       -- Route history indexing
00013_jwt_role_hook.sql             -- JWT role extraction hook
00014_farms.sql                     -- Farms table
00015_daily_planning.sql            -- Daily planning tables/columns
00016_task_assignments_status_repair.sql -- Fix task assignment statuses
00017_parcel_harvest_status.sql     -- Harvest status enum/column
00018_deposits_and_task_destination.sql -- Deposits, task destination FK
00019_geofence_and_push.sql         -- Geofence events, push tokens
00020_task_assignments_unique_active_only.sql -- Unique partial index
00021_add_notification_prefs.sql    -- Notification preferences
00022_missing_rls_policies.sql      -- Fill in missing policies
00023_check_constraints_and_audit.sql -- CHECK constraints, audit improvements
00024_partial_indexes.sql           -- Partial indexes with WHERE deleted_at IS NULL
... (migrations 00025–00041 added in subsequent feature branches)
00042_parcel_crop_and_harvest_extended.sql  -- crop_type enum, harvest_status ladder extension (8 values), harvest_status_rank(), trg_prevent_harvest_status_downgrade
00043_trip_multi_iteration_and_presence.sql -- parent_trip_id/iteration_index on trips, users.last_seen_at, trip_courses view, depot_manager role, truck-idle indexes
... (migrations 00044–00054 added in subsequent feature branches)
00055_fleet_devices.sql                    -- Fleet management + OTA: devices, app_releases, ota_deployments, device_ota_status; 4 new enums (ota_state, ota_deployment_status, release_status, ota_target_kind); server-authoritative tables (no sync_version); RLS defense-in-depth only (backend bypasses as table owner)
00056_fleet_tailscale.sql                  -- Tailscale columns on devices (desired/applied/online/ip/hostname/last_seen/last_error) + singleton app_settings table (auth_key, tailnet, updated_at/by); RLS: no permissive policy, service-role only
00057_fleet_tailscale_oauth_apk.sql        -- app_settings += tailscale_oauth_client_id/secret, tailscale_tag, tailscale_apk_key/sha256/size; OAuth enables per-device ephemeral keys; APK enables zero-touch Tailscale auto-install
... (migrations 00058–00082 added in subsequent feature branches)
00083_cmr_scan_document_type.sql           -- ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'cmr_scan' -- the photographed *paper* CMR from an auxiliary load's external driver (PDF), distinct from the backend-generated 'cmr'; both can exist on the same trip. Single-statement file only -- a new enum label cannot be referenced by any other statement in the same transaction (PG 12+ restriction), so no index/CHECK/backfill was added (idx_documents_trip_request_id from 00076 already covers the lookups).
00084_curse_merge_indexes.sql              -- Indexes/realtime for the merged "Curse" admin page (aux ledger on trip_requests + own-fleet ledger on trips WHERE is_auxiliary=false): idx_trips_trip_request, idx_trips_org_aux_created, idx_trip_requests_org_created; best-effort ALTER PUBLICATION supabase_realtime ADD TABLE trip_requests (swallows duplicate_object/insufficient_privilege/undefined_object). Deliberately does NOT add a partial UNIQUE on trip_requests(machine_id) -- confirm() is not transactional, so a retry could already have minted a duplicate aux machine; audit before constraining.
00085_trip_destination_integrity.sql       -- P0 feature repair: trips.destination_id (00051) was NEVER populated by any code path -> depot-manager confirm flow was fully dead. Backfills from task_assignments then unambiguous destination_name match; excludes auxiliary trips and trips in in_transit/arrived/delivering (safety gate -- flipping destination_has_operator mid-delivery strands the driver). New trigger delivery_destinations_propagate_to_trips() keeps destination_name/address in sync with a depot rename, scoped to non-terminal trips only. Paired backend commit (ef7ec6e) fixed a SECURITY LEAK: GET /trips did SELECT t.* and shipped trips.public_sign_token (CMR sign secret) to every authenticated user -- now an explicit projection, field removed from the Trip type.
00086_trip_number_unique_per_org.sql       -- P0 MULTI-TENANT OUTAGE FIX: trips.trip_number had a GLOBAL unique index while generateTripNumber() counts per-org -> the second org to create a trip on any given day got a duplicate-key error and could create NOTHING. Dropped trips_trip_number_key, added trips_trip_number_org_key UNIQUE (organization_id, trip_number); kept idx_trips_trip_number for value-only lookups.
00087_transportator_role_and_assignments.sql -- New WEB-only 'transportator' enum label (on user_role AND the stale user_role_old); transporter_beneficiaries M:N table (admin-managed, set-replace); trip_requests.created_by_user_id (provenance for the transporter's own-ledger read). Adds users_org_id_key UNIQUE (organization_id, id) as a composite-FK target.
00088_comanda_order.sql                    -- New 'comanda' document_type value; beneficiary_order_settings (singleton per beneficiary: price/payment-term/bale specs/loading info + order_counter); trip_requests += unloading_date, comanda_order_no. RLS scopes a transportator to beneficiary_order_settings rows for beneficiaries they're assigned to via transporter_beneficiaries.
00089_geocode_cache.sql                    -- geocode_cache: server-side reverse-geocode cache (coord_key = "<lat.toFixed(3)>,<lon.toFixed(3)>" -> locality, ~110m buckets) so the tasks-page machine cards / live map don't hammer public Nominatim (~1 req/s) across a 30s-polled fleet. RLS on, no permissive policy (service-role only), same pattern as machine_last_positions/outbound_messages.
00090_trip_request_source_parcel.sql       -- trip_requests.source_parcel_id (nullable FK parcels(id)) -- sibling to source_depot_id (00070): a confirmed request may source from a field instead of a depot. App layer (confirmTripRequestSchema) enforces XOR, not the DB.
00091_parcel_cross_org_fk_hardening.sql    -- Cross-org composite FK hardening for EVERY parcel reference (flagged by automated review): adds parcels_org_id_key UNIQUE (organization_id, id) + composite FKs on trip_requests.source_parcel_id, trips.source_parcel_id, bale_loads.parcel_id, task_assignments.parcel_id -- mirrors the pattern already applied to delivery_destinations (00070) and beneficiaries (00063/00068). Verified zero existing violations before adding (plain FK, not NOT VALID).
00092_cmr_scan_delivery_document_type.sql  -- ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'cmr_scan_delivery' -- the ARRIVAL-side counterpart to 'cmr_scan' (pickup-side): photographed through a one-time public link when an aux load reaches its destination. Single-statement file (same PG 12+ restriction as 00083/00087/00088).
00093_org_feature_overrides.sql            -- Per-org feature-toggle storage: organizations.feature_overrides (JSONB NOT NULL DEFAULT '{}', CHECK jsonb_typeof = 'object') + organizations.plan_label (cosmetic, <=64 chars) + organization_feature_changes audit table (one row per changed key: feature_key, old_enabled nullable, new_enabled, actor_user_id/role, reason NOT NULL, created_at). RLS on organization_feature_changes with no permissive policy (service-role only); org_read_own (00052) already covers the two new organizations columns. See `.claude/docs/feature-toggles.md` for the full system (registry, resolver, backend enforcement).
00094_bale_loads_location_unverified.sql   -- bale_loads.location_unverified (BOOLEAN NOT NULL DEFAULT false) -- a load registered while its GPS could not be checked against the parcel boundary, after the operator confirmed an explicit override prompt. gps_lat/gps_lon still recorded; flag only marks the row for admin review.
00095_widen_location_accuracy.sql          -- machine_location_events.accuracy_m NUMERIC(6,2) -> NUMERIC(9,2) (metadata-only widen, no rewrite): a cell-tower fallback fix had already recorded 9906.20 m, ~94 m from the old 9999.99 ceiling; one fix past it would 500 and the mobile outbox retries any 5xx forever. Backend additionally clamps to this bound (clampAccuracyM, gps-noise.ts).
00096_depot_unload_flow.sql                -- Two-step depot unloading: trips.depot_unload_started_at (stamped by POST /trips/:id/start-depot-unload) + trips.depot_confirm_location_unverified (mirrors bale_loads.location_unverified 00094). Replaces the single-action arrived|delivering->completed confirm with "Începe descărcarea" -> "Finalizează" so the waiting driver sees a mid-state instead of a mute hourglass.
00097_location_event_source.sql            -- machine_location_events.source TEXT ('task'/'checkin'/NULL, whitelisted server-side by normalizeLocationSource() -- no enum, no index). Tags every GPS fix by origin: 'task' = location foreground service, 'checkin' = the 60s presence alarm's best-effort fix (network-quality, presence/geofence only). Tracks + every distance report now exclude source='checkin' up front -- the permanent fix for cell-tower hops (4km/122s = a "legal" 118km/h) masquerading as travel when a phone's location task dies. NULL (pre-vc56 APKs) treated as 'task'.
```

### Key enums (current values)

- `user_role`: `admin`, `baler_operator`, `loader_operator`, `driver`, `geofence_maker`, `depot_manager` (added 00043), `transportator` (added 00087 -- WEB-only external-hauler role; label added to both `user_role` AND the stale `user_role_old` enum so RLS keeps working, see the `::text` cast note below)
- `ota_state`: `pending`, `notified`, `downloading`, `downloaded`, `awaiting_idle`, `installing`, `installed`, `failed` (added 00055)
- `ota_deployment_status`: `pending`, `active`, `completed`, `cancelled` (added 00055)
- `release_status`: `draft`, `published`, `archived` (added 00055)
- `ota_target_kind`: `all`, `org`, `device_set` (added 00055)
- `harvest_status`: `planned`, `to_harvest`, `harvesting`, `partial_harvested`, `harvested`, `in_loading`, `loaded`, `completed` (extended 00042; monotonic ladder enforced by `trg_prevent_harvest_status_downgrade`)
- `crop_type`: `grau`, `orz`, `rapita`, `plante_nutret` (added 00042)
- `document_status`: `pending`, `generating`, `partial`, `generated`, `sent`, `failed`
- `document_type`: `cmr`, `invoice`, `delivery_note`, `weight_ticket`, `report`, `cmr_scan` (added 00083 -- photographed paper CMR, distinct from the backend-generated `cmr`), `comanda` (added 00088 -- auto-generated transport-order PDF for the transporter feature), `cmr_scan_delivery` (added 00092 -- arrival-side counterpart to `cmr_scan`)

### Key design patterns

**Soft deletes**: All mutable tables have `deleted_at TIMESTAMPTZ DEFAULT NULL`. Queries must filter `WHERE deleted_at IS NULL`. Indexes should be partial: `WHERE deleted_at IS NULL`.

**Generated columns**: `net_weight_kg` (gross - tare), `odometer_distance_km` (arrival - departure) are generated columns on the trips table.

**sync_version**: Bigint column on syncable tables (trips, bale_loads, bale_productions, fuel_logs, consumable_logs, task_assignments, machines, parcels). Incremented by a trigger on UPDATE. Used for delta sync -- mobile sends its last known version, server returns rows with higher versions.

**JSONB columns**: `fraud_flags`, `metadata`, `payload` on various tables. Stored as JSONB for flexibility.

**UUID primary keys**: All tables use `UUID DEFAULT gen_random_uuid()` as primary key.

**ISO 8601 timestamps**: All timestamp columns use `TIMESTAMPTZ`.

**Plain TEXT + server-side whitelist over an enum, when the value set is still evolving**: `machine_location_events.source` (00097, `'task'`/`'checkin'`/`NULL`) is a bare `TEXT` column, not an enum, precisely because `ALTER TYPE ... ADD VALUE` is a whole migration per new value and this field is expected to grow more provenance tags later. The column-level type safety is deliberately traded for a single server-side whitelist function (`normalizeLocationSource()` in `location.service.ts`) that maps anything unrecognised to `NULL`. Prefer this over an enum when (a) the set of values is genuinely open-ended and (b) a stray/legacy value degrading to a safe default (here, "treat as the pre-existing behaviour") is acceptable.

**Plain TEXT + app-level enum, no CHECK, for a value set expected to grow (`users.locale`, Aug 2026)**: adding Hungarian as a 3rd interface language needed **zero migration** — `users.locale` was already unconstrained `TEXT DEFAULT 'en'`, and the decision was to keep it that way rather than add a `CHECK (locale IN (...))`. Same underlying trade-off as the `source` column above, one step further: not even a whitelist function at the DB layer, purely a `z.enum(SUPPORTED_LOCALES)` in `@strawboss/validation` (SSOT: `packages/types/src/locale.ts`). Rationale worth repeating for the next "should this be a CHECK/enum" question: a CHECK failure surfaces as Postgres error `23514` → an ORM's generic 500, not a clean 400 the client can render; and a CHECK turns every future addition to the value set into a migration + deploy, when the real gate (zod, compiled per-replica) already rejects an unsupported value before it reaches SQL.

**Cross-org composite FK hardening**: A bare `some_id UUID REFERENCES other_table(id)` lets a row in org A reference a row in org B if the application layer ever forgets an org check. The established fix, applied incrementally to `beneficiaries` (00063/00068), `delivery_destinations` (00070), `users`/`transporter_beneficiaries` (00087), and every remaining `parcels` reference (00091 -- `trip_requests.source_parcel_id`, `trips.source_parcel_id`, `bale_loads.parcel_id`, `task_assignments.parcel_id`):
1. Add a composite unique constraint on the *referenced* table: `ALTER TABLE parcels ADD CONSTRAINT parcels_org_id_key UNIQUE (organization_id, id);` (id is already the PK, so this is purely additive).
2. Replace/add the FK as composite: `ALTER TABLE trips ADD CONSTRAINT trips_source_parcel_org_fkey FOREIGN KEY (organization_id, source_parcel_id) REFERENCES parcels (organization_id, id);`
3. `MATCH SIMPLE` (the default) is correct when the referencing column is nullable (e.g. XOR'd with another source column) -- a `NULL` reference is left unchecked.
4. **Verify zero existing cross-org violations before adding** (`SELECT ... WHERE t.organization_id <> p.organization_id`) so the constraint can be added directly, not `NOT VALID`.
When adding a new FK to an org-scoped table, prefer this pattern from the start rather than hardening it later.

### RLS (Row-Level Security)

Enabled on all tables in `00008_rls_policies.sql`. Helper functions:
- `public.user_role()` -- extracts role from JWT `app_metadata`.
- `public.user_id()` -- extracts user UUID from JWT `sub` claim.

Policy patterns:
- **Admin**: Full CRUD on everything: `FOR ALL USING (public.user_role() = 'admin')`.
- **Dispatcher**: Read all, write task_assignments and trips.
- **Loader operator**: Read assigned tasks/parcels/machines, write bale_loads and trip loading fields.
- **Driver**: Read assigned trips, write trip workflow fields (departure, arrival, delivery).

**CRITICAL — `::text` cast required in new policies**: `public.user_role()` returns the `user_role_old` enum type (stale — see migration 00052). Comparing it directly against a string literal will silently fail for roles added after the enum was frozen (`dispatcher`, `geofence_maker`, `super_admin`, `depot_manager`). Always cast: `public.user_role()::text = 'admin'`. Migration 00055 demonstrates the correct pattern.

When adding new tables:
```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Admin full access (note ::text cast — required due to stale user_role_old enum)
CREATE POLICY admin_all_new_table ON new_table
  FOR ALL USING (public.user_role()::text = 'admin')
  WITH CHECK (public.user_role()::text = 'admin');

-- Role-specific policies as needed
CREATE POLICY driver_read_own_new_table ON new_table
  FOR SELECT USING (
    public.user_role()::text = 'driver'
    AND user_id = public.user_id()
  );
```

### PostGIS

Extension enabled in `00001_extensions_and_enums.sql`. Used for:

- **Parcel boundaries**: `boundary GEOGRAPHY(Polygon, 4326)` on parcels table.
- **Parcel centroids**: `centroid GEOGRAPHY(Point, 4326)` on parcels table.
- **Machine locations**: `machine_location_events` table with `lat`/`lon` columns.
- **Geofence checks**: `ST_Contains(boundary::geometry, ST_MakePoint(lon, lat))` in `geofence.service.ts`.
- **Boundary validation**: `ST_IsValid(boundary::geometry)`.

When writing spatial queries:
- Always cast geography to geometry for `ST_Contains`: `boundary::geometry`.
- Use `ST_MakePoint(longitude, latitude)` (lon first, lat second).
- Use `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` for explicit SRID.

### sync_idempotency table

Prevents duplicate processing of mobile sync mutations:
```sql
CREATE TABLE sync_idempotency (
  idempotency_key UUID PRIMARY KEY,
  table_name TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  server_version BIGINT,
  result_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

The backend checks this table before processing each sync mutation. If the key exists, it returns the cached result.

### Audit logging

`audit_logs` table captures changes via a trigger. The trigger logs the old and new row as JSONB.

### Writing new migrations

The next migration should be `supabase/migrations/00098_<descriptive_name>.sql` (current last: 00097).

Rules:
1. **Idempotent**: Safe to run multiple times.
   - Constraints: `DO $$ BEGIN ALTER TABLE ... ADD CONSTRAINT ...; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
   - Indexes: `CREATE INDEX IF NOT EXISTS ...`
   - Policies: `DROP POLICY IF EXISTS ... ON ...; CREATE POLICY ...`
   - Functions: `CREATE OR REPLACE FUNCTION ...`
   - Columns: `DO $$ BEGIN ALTER TABLE ... ADD COLUMN ...; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`
   - Enum values: `ALTER TYPE some_enum ADD VALUE IF NOT EXISTS 'new_value';` -- must be the **only** statement in the file (PG 12+ forbids referencing a newly-added enum label anywhere else in the same transaction, so no index/CHECK/backfill in that migration; add those in a follow-up migration if needed). See `00083_cmr_scan_document_type.sql`.

2. **Enable RLS** on new tables: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`

3. **Add policies** for each role that needs access.

4. **Partial indexes** with `WHERE deleted_at IS NULL` for tables with soft delete.

5. **sync_version** column if the table participates in mobile sync. Also add a trigger to increment it on UPDATE (see `00007_triggers.sql` for the pattern).

6. **Add to SYNCABLE_TABLES and ALLOWED_COLUMNS** in `backend/service/src/sync/sync.service.ts` if the table should be synced to mobile.

## Rules you must follow

1. All migrations must be idempotent.
2. All new tables must have RLS enabled with appropriate policies.
3. All queries against mutable tables must include `WHERE deleted_at IS NULL`.
4. Use partial indexes (`WHERE deleted_at IS NULL`) for performance.
5. Use UUID primary keys, TIMESTAMPTZ for dates, JSONB for flexible data.
6. Follow the naming convention: lowercase, underscores, descriptive.
7. Test migrations locally before committing: `./strawboss.sh db:migrate`.
8. When adding syncable columns, update `ALLOWED_COLUMNS` in `sync.service.ts`.
9. After schema changes, update `.claude/docs/database.md` (and `agents/db-agent.md` if conventions changed), or run the `strawboss-sync-docs` skill.

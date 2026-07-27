---
type: doc
title: "Database Schema"
created: 2026-04-16
updated: 2026-07-27
tags: [doc, database, schema, postgres, postgis, rls]
status: mature
related:
  - "[[architecture]]"
  - "[[backend]]"
  - "[[sync-protocol]]"
  - "[[packages-types]]"
---

# Database Schema

PostgreSQL on Supabase Cloud with PostGIS. Migrations in `supabase/migrations/` (00001-00091).

## Extensions (00001)

- `uuid-ossp` -- UUID generation (`uuid_generate_v4()`)
- `postgis` -- Spatial types and functions

## Enums (00001, 00009, 00015, 00017, 00055, 00083, 00087, 00088)

| Enum | Values |
|---|---|
| `user_role` | `admin`, `baler_operator`, `loader_operator`, `driver`, `geofence_maker` (dispatcher removed in 00009), `depot_manager` (added 00043), `transportator` (added 00087 -- WEB-only external-hauler account; label added to both `user_role` AND the stale `user_role_old`, mirroring the 00079 fix, so RLS keeps working for a transportator session) |
| `machine_type` | `truck`, `loader`, `baler` |
| `fuel_type` | `diesel`, `gasoline`, `electric` |
| `trip_status` | `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`, `cancelled`, `disputed` |
| `parcel_status` | `active`, `inactive` |
| `consumable_type` | `twine`, `net_wrap`, `silage_film`, `other` |
| `document_type` | `cmr`, `invoice`, `delivery_note`, `weight_ticket`, `report`, `cmr_scan` (added 00083 -- the photographed *paper* CMR from an auxiliary load's external driver, distinct from the backend-generated `cmr`; both can coexist on one trip), `comanda` (added 00088 -- auto-generated transport-order PDF for the transporter feature) |
| `document_status` | `pending`, `generating`, `partial`, `generated`, `sent`, `failed` |
| `alert_category` | `fraud`, `anomaly`, `maintenance`, `safety`, `system` |
| `alert_severity` | `low`, `medium`, `high`, `critical` |
| `audit_operation` | `insert`, `update`, `delete` |
| `assignment_priority` | `low`, `normal`, `high`, `urgent` |
| `task_assignment_status` | `available`, `in_progress`, `done` |
| `harvest_status` | `planned`, `to_harvest`, `harvesting`, `partial_harvested`, `harvested`, `in_loading`, `loaded`, `completed` (extended in 00042) |
| `crop_type` | `grau`, `orz`, `rapita`, `plante_nutret` (added 00042) |
| `ota_state` | `pending`, `notified`, `downloading`, `downloaded`, `awaiting_idle`, `installing`, `installed`, `failed` (added 00055) |
| `ota_deployment_status` | `pending`, `active`, `completed`, `cancelled` (added 00055) |
| `release_status` | `draft`, `published`, `archived` (added 00055) |
| `ota_target_kind` | `all`, `org`, `device_set` (added 00055) |

## Tables

### Core Tables (00002)

**users**: `id` (UUID PK), `email` (UNIQUE), `phone`, `full_name`, `role` (user_role, default `driver`), `password_hash`, `is_active`, `locale` (default `en`), `avatar_url`, `last_login_at`, `assigned_machine_id` (FK machines, added 00011), `notification_prefs` (JSONB, added 00021), `last_seen_at` (TIMESTAMPTZ nullable, updated by `POST /profile/heartbeat` every 30s from mobile, added 00043), timestamps, `deleted_at`.

**parcels**: `id` (UUID PK), `code` (UNIQUE), `name` (nullable per 00010), `area_hectares` (NUMERIC 10,2), `boundary` (GEOMETRY Polygon 4326), `centroid` (GEOMETRY Point 4326), `address`, `municipality`, `farmtrack_geofence_id`, `farm_id` (FK farms, added 00014), `harvest_status` (added 00017, default `planned`; extended ladder 00042), `crop_type` (crop_type enum, nullable, added 00042), `notes`, `is_active`, timestamps, `deleted_at`.

**machines**: `id` (UUID PK), `machine_type`, `registration_plate`, `internal_code` (UNIQUE), `make`, `model`, `year`, `fuel_type`, `tank_capacity_liters`, `farmtrack_device_id`, `current_odometer_km` (default 0), `current_hourmeter_hrs` (default 0), `is_active`, `max_payload_kg`, `max_bale_count`, `tare_weight_kg`, `bales_per_hour_avg`, `bale_weight_avg_kg`, `reach_meters`, `company_name`, `company_address`, timestamps, `deleted_at`.

**delivery_destinations**: `id`, `code` (UNIQUE), `name`, `address`, `coords` (GEOMETRY Point 4326), `contact_name`, `contact_phone`, `contact_email`, `boundary` (GEOMETRY Polygon 4326, added 00018), `is_active`, timestamps, `deleted_at`.

### Operations Tables (00003)

**task_assignments**: `id`, `assignment_date` (DATE), `machine_id` (FK), `parcel_id` (FK, nullable), `assigned_user_id` (FK, nullable), `priority` (default `normal`), `sequence_order` (INT), `status` (task_assignment_status, default `available`, added 00015), `parent_assignment_id` (FK self, added 00015), `destination_id` (FK delivery_destinations, added 00018), timestamps, `deleted_at`. Unique constraint: `(assignment_date, machine_id, sequence_order)` among non-deleted rows only (partial unique index, 00020).

**trips**: `id`, `trip_number` (UNIQUE **per `organization_id`** -- `trips_trip_number_org_key`, see 00086 below; was globally unique before that fix), `status` (default `planned`), `source_parcel_id` (FK parcels, cross-org composite FK added 00091), `source_parcel_auto`, `loader_id` (FK machines), `truck_id` (FK machines, NOT NULL), `loader_operator_id` (FK users), `driver_id` (FK users, NOT NULL), `bale_count` (default 0), phase timestamps, odometer fields, `gps_distance_km`, destination info incl. `destination_id` (FK delivery_destinations, added 00051 -- see 00085 below for the backfill/repair), weight fields, `net_weight_kg` (**GENERATED** = gross - tare), `odometer_distance_km` (**GENERATED** = arrival - departure), `distance_discrepancy_km`, `loader_signature_url` (TEXT, saved at complete-loading), `driver_signature_url` (TEXT, saved at depart), `deteriorated_bales_count` (INT, saved at confirm-delivery), `fraud_flags` (JSONB), `client_id`, `sync_version` (BIGINT default 1), `parent_trip_id` (FK trips self, nullable, added 00043), `iteration_index` (INT NOT NULL DEFAULT 1, CHECK >= 1, added 00043), `organization_id` (FK organizations, 00036), `is_auxiliary` (BOOLEAN -- distinguishes own-fleet trips from auxiliary/external-hauler trips), `trip_request_id` (FK trip_requests, nullable -- links an auxiliary trip back to the portal request that spawned it, indexed 00084), `public_sign_token` (one-time bearer secret for account-less external-driver CMR signing on auxiliary trips -- **never select via `t.*`**; removed from the `Trip` type and both read-endpoint projections 2026-07-14 after it leaked through `GET /trips` to every authenticated user, see [[backend]]), timestamps, `deleted_at`. (`organization_id`/`is_auxiliary`/`trip_request_id`/`public_sign_token` predate this doc's last full pass -- added in the undocumented 00058-00082 gap; listed here only because 00084/00085/00086/00091 touch them directly.)

**bale_loads**: `id`, `trip_id` (FK NOT NULL), `parcel_id` (FK NOT NULL), `loader_id` (FK), `operator_id` (FK), `bale_count` (CHECK > 0), `loaded_at`, GPS coords, `farmtrack_event_id`, `notes`, `client_id`, `sync_version`, timestamps, `deleted_at`.

**bale_productions**: `id`, `parcel_id` (FK NOT NULL), `baler_id` (FK NOT NULL), `operator_id` (FK), `production_date` (DATE), `bale_count` (CHECK > 0), `avg_bale_weight_kg`, `start_time`, `end_time`, `farmtrack_session_id`, timestamps, `deleted_at`.

### Support Tables (00004)

**fuel_logs**: `id`, `machine_id` (FK NOT NULL), `operator_id` (FK), `parcel_id` (FK), `logged_at`, `fuel_type` (NOT NULL), `quantity_liters` (NOT NULL), `unit_price`, `total_cost`, `odometer_km`, `hourmeter_hrs`, `is_full_tank`, `receipt_photo_url`, `notes`, `client_id`, `sync_version`, timestamps, `deleted_at`.

**consumable_logs**: `id`, `machine_id` (FK NOT NULL), `operator_id`, `parcel_id`, `consumable_type` (NOT NULL), `description`, `quantity` (NOT NULL), `unit` (NOT NULL), `unit_price`, `total_cost`, `logged_at`, timestamps, `deleted_at`.

**documents**: `id`, `trip_id` (FK), `document_type` (NOT NULL), `status` (default `pending`), `title` (NOT NULL), `file_url`, `file_size_bytes` (BIGINT), `mime_type`, `metadata` (JSONB), `generated_at`, `sent_at`, `sent_to` (TEXT[]), timestamps, `deleted_at`.

**alerts**: `id`, `category` (NOT NULL), `severity` (NOT NULL), `title` (NOT NULL), `description`, `related_table`, `related_record_id`, `trip_id` (FK), `machine_id` (FK), `data` (JSONB), `is_acknowledged` (default false), `acknowledged_by` (FK users), `acknowledged_at`, `resolution_notes`, timestamps. No `deleted_at`.

### Audit & Sync Tables (00005)

**audit_logs**: Append-only. `id`, `table_name`, `record_id`, `operation`, `old_values`/`new_values` (JSONB), `changed_fields` (TEXT[]), `user_id`, `client_id`, `ip_address` (INET), `created_at`. Protected by `RULE audit_logs_no_update` and `audit_logs_no_delete`.

**farmtrack_events**: `id`, `farmtrack_event_id` (UNIQUE), `event_type`, `device_id`, `machine_id` (FK), `geofence_id`, `parcel_id` (FK), `timestamp`, `coords` (GEOMETRY Point 4326), `payload` (JSONB), `is_processed`, `processed_at`, `created_at`.

**sync_idempotency**: `client_id`, `table_name`, `record_id`, `client_version`, `server_version`, `processed_at`. PK: `(client_id, table_name, record_id, client_version)`.

### Later Migrations

**machine_location_events** (00009): `id`, `machine_id` (FK), `operator_id` (FK), `lat`, `lon`, `coords` (**GENERATED** via `ST_SetSRID(ST_MakePoint(lon, lat), 4326)`), `accuracy_m`, `heading_deg`, `speed_ms`, `recorded_at`, `created_at`.

**farms** (00014): `id`, `name` (NOT NULL), `address`, `phone`, `fiscal_code`, `registration_number`, `bank_account`, `bank_name`, timestamps, `deleted_at`.

**parcel_daily_status** (00015): `id`, `parcel_id` (FK NOT NULL), `status_date` (DATE), `is_done`, `notes`, timestamps. UNIQUE `(parcel_id, status_date)`.

**device_push_tokens** (00019): `id`, `user_id` (FK NOT NULL), `machine_id` (FK), `token`, `platform` (default `android`), `is_active`, timestamps. UNIQUE `(user_id, token)`.

**geofence_events** (00019): `id`, `machine_id` (FK NOT NULL), `assignment_id` (FK), `geofence_type`, `geofence_id`, `event_type`, `lat`, `lon`, `created_at`.

### Fleet / OTA Tables (00055)

Migration `00055_fleet_devices.sql`. These tables are **server-authoritative** (not mobile-synced, no `sync_version`). The NestJS backend connects as the table owner and bypasses RLS; RLS is defense-in-depth only for a future direct PostgREST/Realtime path.

**devices**: Registry of every installed app instance. `id` (UUID PK), `device_uuid` (TEXT UNIQUE — SecureStore-persisted identity), `organization_id` (FK organizations, nullable until super-admin assigns it), `name`, `android_id`, `model`, `manufacturer`, `os_version`, `app_version` (versionName), `version_code` (INT — monotonic, for downgrade/skew checks), `push_token` (FCM), `device_token_hash` (NOT NULL — HMAC of device_uuid issued on first registration, verified on every check-in), `is_device_owner` (BOOLEAN, default false), `last_seen_at`, `last_checkin_at`, `last_active_trip` (BOOLEAN, default false — idle-gate flag), timestamps, `deleted_at`.

Additional Tailscale columns added in 00056 (all idempotent `ADD COLUMN IF NOT EXISTS`): `tailscale_desired` (BOOLEAN NOT NULL DEFAULT false — super-admin sets the desired state), `tailscale_applied` (BOOLEAN NOT NULL DEFAULT false — last confirmed state the device applied via a command report), `tailscale_online` (BOOLEAN NOT NULL DEFAULT false — written by a host-side `tailscale status` sync), `tailscale_ip` (TEXT — 100.x tailnet IP), `tailscale_hostname` (TEXT — sanitized Tailscale nickname), `tailscale_last_seen` (TIMESTAMPTZ), `tailscale_last_error` (TEXT — best-effort device-reported error from the last command attempt).

The backend issues a Tailscale command only while `tailscale_applied <> tailscale_desired`. The online/IP/hostname fields are populated by a host-side daemon (the backend container cannot reach the tailnet directly).

Indexes: `idx_devices_org` (organization_id WHERE deleted_at IS NULL), `idx_devices_last_seen` (last_seen_at WHERE deleted_at IS NULL).

**app_releases**: An uploaded APK. `id` (UUID PK), `version` (TEXT), `version_code` (INT UNIQUE among non-deleted rows — prevents two releases claiming the same code), `apk_key` (TEXT — storage path under `UPLOADS_ROOT/apks/`), `sha256` (hex digest, verified on-device before install), `size_bytes` (BIGINT), `changelog`, `mandatory` (BOOLEAN, default false), `status` (release_status, default `draft`), `uploaded_by` (FK users), timestamps, `deleted_at`.

Indexes: `uq_app_releases_version_code` (UNIQUE partial on version_code WHERE deleted_at IS NULL), `idx_app_releases_status`.

**ota_deployments**: One release pushed/scheduled to a set of devices. `id` (UUID PK), `release_id` (FK app_releases NOT NULL), `target_kind` (ota_target_kind NOT NULL), `target_org_id` (FK organizations, used when target_kind = `org`), `target_device_ids` (UUID[], used when target_kind = `device_set`), `scheduled_at` (TIMESTAMPTZ nullable — NULL = immediate; a BullMQ-delayed job flips status → active at this time), `force_now` (BOOLEAN, default false — bypasses the device idle gate), `status` (ota_deployment_status, default `pending`), `created_by` (FK users), timestamps. No `deleted_at`.

Index: `idx_ota_deployments_status`.

**device_ota_status**: Per-device state-machine instance for one deployment. `id` (UUID PK), `deployment_id` (FK ota_deployments NOT NULL), `device_id` (FK devices NOT NULL), `state` (ota_state, default `pending`), `error` (TEXT), `attempt` (INT, default 0), `notified_at`, `downloaded_at`, `installed_at`, `created_at`, `updated_at`. UNIQUE `(deployment_id, device_id)`. No `deleted_at`.

State machine: the **device** drives forward transitions (reported on check-in via `DeviceOtaReport`); the backend only sets `pending → notified` and confirms `installed` on versionCode proof.

Indexes: `idx_device_ota_status_device` (device_id, state), `idx_device_ota_status_deployment` (deployment_id, state).

### app_settings Singleton (00056, extended 00057)

**app_settings**: Global config the super-admin edits. Enforced as a singleton via a BOOLEAN primary key (`id` always `true`) and a CHECK constraint (`app_settings_singleton: id = true`). A seed `INSERT ... ON CONFLICT DO NOTHING` ensures the row always exists. RLS enabled; **no permissive policy** — service-role (backend) only; raw secret values are never surfaced to clients.

Columns added in `00056_fleet_tailscale.sql`:

| Column | Type | Notes |
|---|---|---|
| `tailscale_auth_key` | TEXT | Shared Tailscale auth key (secret, masked) |
| `tailscale_tailnet` | TEXT NOT NULL DEFAULT `'tail2b4c34.ts.net'` | The tailnet name |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `updated_by` | UUID FK users | |

Columns added in `00057_fleet_tailscale_oauth_apk.sql` (all `ADD COLUMN IF NOT EXISTS`):

| Column | Type | Notes |
|---|---|---|
| `tailscale_oauth_client_id` | TEXT | OAuth client ID (enables per-device ephemeral keys) |
| `tailscale_oauth_client_secret` | TEXT | OAuth secret (secret, masked) |
| `tailscale_tag` | TEXT | Tag applied to OAuth-minted keys, e.g. `tag:fleet-phone`; must exist in the tailnet ACL |
| `tailscale_apk_key` | TEXT | Storage path of the hosted Tailscale APK (served via signed URL) |
| `tailscale_apk_sha256` | TEXT | Hex SHA-256 of the APK, verified before install |
| `tailscale_apk_size` | BIGINT | APK size in bytes |

The OAuth path mints short-lived, tagged, ephemeral auth keys per device on demand (one per check-in command), so the long-lived shared key is never broadcast to phones.

### RLS Posture (00055)

RLS is enabled on all four fleet tables. The backend (table owner via `DATABASE_URL`) bypasses RLS entirely — it is the sole writer.

- **devices**: One permissive SELECT policy `admin_read_devices` — `user_role()::text = 'admin' AND organization_id = user_org_id()`. Org admins can read their own assigned devices; rows with `organization_id IS NULL` are invisible through this path. Super-admin acts via service-role connection.
- **app_releases**, **ota_deployments**, **device_ota_status**: No permissive policies defined — super-admin/service-role only. Any direct PostgREST access is blocked by default-deny.

**RLS note**: `::text` cast on `user_role()` is required (stale `user_role_old` enum — see migration 00052 and [[database]] gotcha documented in MEMORY.md).

### Trip Destination Integrity + Trip-Number Uniqueness (00085, 00086)

**00085_trip_destination_integrity.sql** repairs a fully dead feature: `trips.destination_id` (added 00051 to mirror `task_assignments.destination_id`, 00018) was **never populated by any code path**, so it was `NULL` on every production trip. That silently broke `confirmDepotDelivery()` (threw `no_destination`), the depot-manager sync pull (filtered on `destination_id` → pulled zero trips), `destination_has_operator` (always false, so drivers never got the "wait for depot operator" flow), and the `depot_manager_*` RLS policies (00053, matched nothing). Companion backend commit `ef7ec6e` now sets `destination_id` on all own-fleet creation paths; this migration backfills history:
- Backfill 1: from `task_assignments.trip_id` → `task_assignments.destination_id` (the authoritative link).
- Backfill 2 (fallback): by `destination_name`, but only when the name resolves to exactly one live depot in the same org (ambiguous/unmatched names are left `NULL` — a wrong depot is worse than a missing one).
- Both backfills exclude auxiliary trips (they deliver to a customer yard, never a depot) and exclude trips in `in_transit`/`arrived`/`delivering` — a safety gate: setting `destination_id` flips `destination_has_operator` true, and that value is in the sync pull, so a driver mid-delivery would suddenly hit a read-only "wait for the depot operator" screen with no way to proceed.
- New trigger `delivery_destinations_propagate_to_trips()` (`AFTER UPDATE OF name, address ON delivery_destinations`, SECURITY DEFINER) keeps `trips.destination_name`/`destination_address` in sync with a depot rename, but only for **non-terminal** trips — a CMR is a legal transport document, so a delivered/completed/cancelled/disputed trip keeps the name it was transported under. Mirrors `farms_propagate_name_to_parcels` (00065).

The same commit (`ef7ec6e`) also fixed a **security leak in application code** (not schema): `GET /trips` (`list()`/`findById()`, no `@Roles` at all) was doing `SELECT t.*`, which shipped `trips.public_sign_token` — the one-time bearer secret that lets an account-less external auxiliary-load driver sign a CMR through a public link — to every authenticated driver/loader in the org. Fixed by an explicit column projection and by removing the field from the `Trip` type entirely. See [[backend]] for the endpoint-level detail; noted here because it travelled in the same commit as the destination-integrity migration.

**00086_trip_number_unique_per_org.sql** — **P0 multi-tenant outage, fixed**. `trips.trip_number` carried the original globally-unique index `trips_trip_number_key` (from 00003, before multi-tenancy existed), but `TripsService.generateTripNumber()` counts trips **per organization** to mint `TR-<yyyymmdd>-NNN`. On any day org A had already created a trip, org B's own count-from-0 collided with org A's row on the global unique index — every truck-task assignment failed, for the whole day, for whichever org was not first. Observed in production 2026-07-14 (StrawBoss held `TR-20260714-001..003`, AgroBrothers could create nothing). Fix: drop `trips_trip_number_key`, add `trips_trip_number_org_key UNIQUE (organization_id, trip_number)` — strictly more permissive than the constraint it replaces, so it cannot fail on existing data. The old plain-value lookup index is preserved as `idx_trips_trip_number` (trip numbers are still searched by value alone in places).

### Transporter Role Tables (00087, 00088)

Migration `00087_transportator_role_and_assignments.sql` backs the new **WEB-only `transportator`** account type (see also [[admin-web]]): an external hauler who can only read a filtered trip-request ledger and submit an authenticated pickup request.

- **`transporter_beneficiaries`**: M:N link an admin manages (set-replace / hard delete) saying which beneficiaries a transporter may act for. `id` (UUID PK), `organization_id` (FK organizations, CASCADE), `transporter_user_id`, `beneficiary_id`, `created_at`. UNIQUE `(transporter_user_id, beneficiary_id)`. Composite cross-org FKs: `(organization_id, transporter_user_id)` → `users(organization_id, id)` and `(organization_id, beneficiary_id)` → `beneficiaries(organization_id, id)`, both `ON DELETE CASCADE`. Indexes: `idx_transporter_beneficiaries_user`, `idx_transporter_beneficiaries_ben`, `idx_transporter_beneficiaries_org`.
- **`users_org_id_key`**: new `UNIQUE (organization_id, id)` on `users` (replacing the plain `idx_users_org_id`, 00036) — required so the composite FK above has a unique target; purely additive, `id` was already the PK.
- **`trip_requests.created_by_user_id`** (UUID, FK `users(id)`, nullable): provenance stamped by the authenticated transporter request form; `NULL` for the public portals (4-digit code + beneficiary PIN). Backs the transporter's "my trips" ledger. Index `idx_trip_requests_created_by (organization_id, created_by_user_id) WHERE deleted_at IS NULL AND created_by_user_id IS NOT NULL`.

Migration `00088_comanda_order.sql` adds the auto-generated "comandă" (transport order) PDF:

- **`beneficiary_order_settings`**: singleton-per-beneficiary order defaults the transporter configures once. `id`, `organization_id` (FK organizations, CASCADE), `beneficiary_id`, `transport_value` (NUMERIC 12,2), `currency` (default `'EUR'`), `payment_term_days` (default 30), `bale_count`, `bale_dimensions`, `goods_name`, `truck_description`, `loading_locality`, `loading_country`, `obs`, `order_counter` (INT default 0, incremented per generated order), timestamps. UNIQUE `(organization_id, beneficiary_id)`. Composite cross-org FK `(organization_id, beneficiary_id)` → `beneficiaries(organization_id, id)`, `ON DELETE CASCADE`. Indexes: `idx_beneficiary_order_settings_ben`, `idx_beneficiary_order_settings_org`.
- **`trip_requests.unloading_date`** (DATE) and **`trip_requests.comanda_order_no`** (INT, set once so regeneration is idempotent).
- Generated comandă PDFs live in `documents` under the new `comanda` document_type.

RLS (defense-in-depth; backend bypasses as table owner) on both new tables follows the 00068 convention — read caller role/org straight from `users` via `auth.uid()`, cast `role::text`, sidestepping the stale `user_role()`/`user_role_old` function:
- `transporter_beneficiaries`: admin/super_admin full CRUD (org-scoped); a `transportator` may `SELECT` only their own rows (`transporter_user_id = auth.uid()`).
- `trip_requests` (already RLS-enabled, 00054): additive `trip_requests_transporter_read` policy — a transporter may `SELECT` only requests where `created_by_user_id = auth.uid()`, org-scoped.
- `beneficiary_order_settings`: admin/super_admin full CRUD (org-scoped); a `transportator` gets full CRUD scoped to `beneficiary_id IN (SELECT beneficiary_id FROM transporter_beneficiaries WHERE transporter_user_id = auth.uid())`.

### geocode_cache (00089)

Server-side reverse-geocode cache: `(rounded coordinate) → nearest locality`, backing the tasks-page machine cards' "near \<locality\>" label and the admin live map. Avoids hammering the public Nominatim endpoint (~1 req/s) when the machine-location feed is polled every 30s fleet-wide — a parked machine geocodes once, every later poll at the same spot is a cache hit.

**geocode_cache**: `coord_key` (TEXT PK — `"<lat.toFixed(3)>,<lon.toFixed(3)>"`, ~110m buckets, org-agnostic — a place is a place regardless of tenant), `locality` (nullable — a cached negative result, e.g. open water or a Nominatim miss, so it isn't re-hammered), `lat`/`lon` (NUMERIC 10,7), `geocoded_at` (TIMESTAMPTZ default now()). Index `idx_geocode_cache_geocoded_at` (lets the async filler prune/re-geocode stale rows). RLS enabled, **no permissive policy** — same "service-role only" pattern as `machine_last_positions` (00081) and `outbound_messages` (00071): reads happen only through authed, org-scoped backend endpoints, never direct PostgREST/anon access.

### trip_requests.source_parcel_id (00090) + Cross-Org Parcel FK Hardening (00091)

`00090_trip_request_source_parcel.sql` adds `trip_requests.source_parcel_id` (UUID, FK `parcels(id)`, nullable, indexed `WHERE source_parcel_id IS NOT NULL`) — sibling to `source_depot_id` (00070): a confirmed trip_request may now source directly from a field instead of a depot. The app layer, not the DB, enforces "confirm requires exactly one of depotId/parcelId" (`confirmTripRequestSchema`).

`00091_parcel_cross_org_fk_hardening.sql` — **security-relevant DB hardening**, flagged by an automated code-review pass. `source_parcel_id` shipped in 00090 without the cross-org composite FK that `source_depot_id` already had (from 00070); auditing turned up the same gap on three more long-standing parcel references that had never been hardened: `trips.source_parcel_id`, `bale_loads.parcel_id`, `task_assignments.parcel_id`. Fix, verified against zero existing violations before applying (so a plain, non-`NOT VALID`, composite FK was safe):
- New composite unique target `parcels_org_id_key UNIQUE (organization_id, id)`.
- Four new composite FKs, all `(organization_id, <col>) REFERENCES parcels (organization_id, id)`, `MATCH SIMPLE` (default — a `NULL` parcel reference is unchecked, required since every one of these columns is nullable): `trip_requests_source_parcel_org_fkey`, `trips_source_parcel_org_fkey`, `bale_loads_parcel_org_fkey`, `task_assignments_parcel_org_fkey`.

This closes the same class of gap as the composite FKs already shipped for `delivery_destinations` (00070) and `beneficiaries` (00063/00068) — a row in org A can no longer reference a `parcels` row belonging to org B, at the database level, regardless of what the application layer does or forgets to check. It is **not** a 1:1 fix for any single catalogued finding in `.claude/issues/security-audit-2026-05-11.md` (that audit's still-open H-8/H-9/H-10 are about *other* unguarded FK columns — `bale_loads.trip_id`, `bale_productions.parcelId`/`balerId`/`operatorId`, `consumable_logs.*` — which this migration does not touch); it is documented here as defense-in-depth that structurally closes the parcel-reference slice of that same bug class.

## Generated Columns

- `trips.net_weight_kg` = `gross_weight_kg - tare_weight_kg` (STORED)
- `trips.odometer_distance_km` = `arrival_odometer_km - departure_odometer_km` (STORED)
- `machine_location_events.coords` = `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` (STORED)

## CHECK Constraints (00023)

- `chk_weights_positive`: `gross_weight_kg IS NULL OR gross_weight_kg > 0`
- `chk_tare_positive`: `tare_weight_kg IS NULL OR tare_weight_kg > 0`
- `chk_net_weight_sane`: `gross_weight_kg >= tare_weight_kg` (when both non-null)
- `chk_odometer_order`: `arrival_odometer_km >= departure_odometer_km` (when both non-null)
- `bale_loads.bale_count > 0`, `bale_productions.bale_count > 0` (inline CHECK in 00003)

## Unique / Composite-FK Constraints (00086, 00087, 00091)

- `trips_trip_number_org_key UNIQUE (organization_id, trip_number)` — replaces the pre-multi-tenancy global `trips_trip_number_key` (00086; see "Trip Destination Integrity + Trip-Number Uniqueness" above — this was a P0 fix).
- `users_org_id_key UNIQUE (organization_id, id)` (00087) and `parcels_org_id_key UNIQUE (organization_id, id)` (00091) — composite-unique FK targets, part of the repo-wide cross-org-hardening pattern (also used by `beneficiaries`/`delivery_destinations`, 00063/00068/00070): every FK into an org-scoped table should be `(organization_id, <col>) REFERENCES <table> (organization_id, id)`, not a bare `<col> REFERENCES <table>(id)`, so a row can never reference another organization's data even if application code forgets to check.
- Composite cross-org FKs following that pattern: `transporter_beneficiaries_user_org_fkey`, `transporter_beneficiaries_ben_org_fkey` (00087); `beneficiary_order_settings_ben_org_fkey` (00088); `trip_requests_source_parcel_org_fkey`, `trips_source_parcel_org_fkey`, `bale_loads_parcel_org_fkey`, `task_assignments_parcel_org_fkey` (00091).

## Indexes (00006, 00009, 00012, 00014, 00015, 00018, 00019, 00024, 00042, 00043, 00084, 00086, 00087, 00088, 00089, 00090)

Key partial indexes (00024, filter `deleted_at IS NULL`):
- `idx_trips_status_active`, `idx_trips_driver_active`, `idx_trips_created_active`

New in 00042 (parcels, `WHERE deleted_at IS NULL`):
- `idx_parcels_crop_type` (WHERE crop_type IS NOT NULL), `idx_parcels_harvest_status`

New in 00043:
- `idx_users_last_seen_at` (DESC, WHERE last_seen_at IS NOT NULL, partial)
- `uq_trips_parent_iteration` (UNIQUE on parent_trip_id, iteration_index WHERE deleted_at IS NULL AND parent_trip_id IS NOT NULL)
- `idx_trips_parent_trip_id` (partial)
- `idx_trips_truck_status_open` (truck_id, status WHERE open statuses and not deleted)

Spatial (GIST): `idx_parcels_boundary`, `idx_parcels_centroid`, `idx_mle_coords`, `idx_delivery_destinations_boundary`

Composite: `idx_mle_machine_recorded (machine_id, recorded_at ASC)`, `idx_task_assignments_status (assignment_date, status) WHERE deleted_at IS NULL`

New in 00084 (the merged "Curse" admin page — auxiliary ledger anchored on `trip_requests`, own-fleet ledger on `trips WHERE is_auxiliary = false`):
- `idx_trips_trip_request (trip_request_id) WHERE deleted_at IS NULL AND trip_request_id IS NOT NULL`
- `idx_trips_org_aux_created (organization_id, is_auxiliary, created_at DESC) WHERE deleted_at IS NULL`
- `idx_trip_requests_org_created (organization_id, created_at DESC) WHERE deleted_at IS NULL`
- Also adds `trip_requests` to the `supabase_realtime` publication (best-effort — wrapped to swallow `duplicate_object`/`insufficient_privilege`/`undefined_object`, since publication membership is otherwise managed out-of-band in the Supabase dashboard) so a new portal request appears on the Curse page without a refresh.

New in 00086: `idx_trips_trip_number (trip_number)` — plain lookup index preserved after `trips_trip_number_key` was dropped (see Unique Constraints above).

New in 00087 (transportator role): `idx_transporter_beneficiaries_user`, `idx_transporter_beneficiaries_ben`, `idx_transporter_beneficiaries_org`, `idx_trip_requests_created_by (organization_id, created_by_user_id) WHERE deleted_at IS NULL AND created_by_user_id IS NOT NULL`.

New in 00088 (comandă): `idx_beneficiary_order_settings_ben`, `idx_beneficiary_order_settings_org`.

New in 00089 (geocode cache): `idx_geocode_cache_geocoded_at`.

New in 00090 (field-sourced aux pickups): `idx_trip_requests_source_parcel (source_parcel_id) WHERE source_parcel_id IS NOT NULL`.

## Views (00043)

**trip_courses**: Recursive CTE view that aggregates a multi-iteration trip course into one row. Columns: `course_root_id`, `iteration_count`, `last_iteration_index`, `total_delivered_bales`, `has_open_iteration`, `started_at`, `last_completed_at`. Read-only. Used by admin dashboards and the deposit incoming list.

## Functions (00042)

**`harvest_status_rank(s harvest_status) RETURNS INT`**: Maps each `harvest_status` value to an integer rank (planned=0 … completed=7) for monotonic comparison. Used by `trg_prevent_harvest_status_downgrade`.

## Triggers (00007, 00023, 00042, 00085)

### `set_updated_at()` -- Auto-update `updated_at` on every UPDATE
Applied to: `users`, `parcels`, `machines`, `delivery_destinations`, `task_assignments`, `trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `documents`, `alerts`.

### `audit_trigger_func()` -- Generic audit logging (AFTER INSERT/UPDATE/DELETE)
Applied to: `trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `machines`, `parcels`, `task_assignments`, `users`, `delivery_destinations`, `documents` (expanded in 00023 to include DELETE and more tables).

Extracts `user_id` from JWT claims. Extracts `client_id` from the record's own column (for offline sync attribution). Skips audit if UPDATE changes no fields.

### `prevent_harvest_status_downgrade()` -- Block backward harvest_status transitions (00042)
Applied to: `parcels` (BEFORE UPDATE OF harvest_status). Raises `check_violation` if `harvest_status_rank(NEW) < harvest_status_rank(OLD)`. Bypass with `SET LOCAL app.allow_harvest_downgrade = 'on'` (data-fix scripts only).

### `delivery_destinations_propagate_to_trips()` -- Propagate a depot rename onto its trips (00085)
`trg_delivery_destinations_propagate`, `AFTER UPDATE OF name, address ON delivery_destinations`, `WHEN` the name or address actually changed. `SECURITY DEFINER` (so it works over the direct PostgREST path too). Updates `trips.destination_name`/`destination_address` (and re-stamps `updated_at`, which bumps `sync_version` so phones re-pull) for every trip `WHERE destination_id = NEW.id`, **excluding terminal trips** (`delivered`/`completed`/`cancelled`/`disputed` keep the name they were transported under — a CMR is a legal document). Only touches the two denormalized columns, never `destination_id`, so it cannot recurse. Mirrors `farms_propagate_name_to_parcels` (00065).

## JWT Role Hook (00013)

`custom_access_token_hook(event jsonb)`: Supabase Custom Access Token Hook that injects `users.role` into `claims.app_metadata.role`. Must be enabled in Supabase Dashboard under Authentication > Hooks.

## RLS Policies (00008, 00009, 00022)

RLS enabled on all tables.

- **Admin**: Full CRUD on everything. Read-only on `audit_logs`.
- **Baler Operator** (00009): Read parcels/machines. Read own assignments. CRUD own `bale_productions` and `fuel_logs`.
- **Loader Operator**: Read parcels/machines. Read own assignments/trips. CRUD own `bale_loads` and `fuel_logs`. Update trips in `loading`/`loaded` status where `loader_operator_id` matches.
- **Driver**: Read parcels/machines/destinations. Read own assignments/trips. Update own trips in `loaded`/`in_transit`/`arrived`/`delivering`/`delivered` (expanded in 00022). CRUD own `fuel_logs`. Read own `bale_loads` and `documents`.
- **Farms/parcel_daily_status** (00022): Admin full CRUD, everyone can SELECT.
- **Geofence events** (00022): Admin all; others read own machine's events.
- **Device push tokens** (00022): Users manage own tokens; admin manages all.
- **Transportator** (00087, 00088 — WEB-only, defense-in-depth, backend bypasses as table owner): may `SELECT` own `transporter_beneficiaries` rows; may `SELECT` `trip_requests` where `created_by_user_id = auth.uid()`; full CRUD on `beneficiary_order_settings` scoped to assigned beneficiaries only. See "Transporter Role Tables" above for the exact policies.
- **geocode_cache** (00089): RLS on, **no permissive policy at all** — service-role/backend only, same as `machine_last_positions` (00081) / `outbound_messages` (00071).

## Auto-increment Sequence (00010)

`parcels_code_seq` -- generates readable parcel codes like `P-0001`.

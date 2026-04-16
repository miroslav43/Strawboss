# Database Schema

PostgreSQL on Supabase Cloud with PostGIS. Migrations in `supabase/migrations/` (00001-00024).

## Extensions (00001)

- `uuid-ossp` -- UUID generation (`uuid_generate_v4()`)
- `postgis` -- Spatial types and functions

## Enums (00001, 00009, 00015, 00017)

| Enum | Values |
|---|---|
| `user_role` | `admin`, `baler_operator`, `loader_operator`, `driver` (dispatcher removed in 00009) |
| `machine_type` | `truck`, `loader`, `baler` |
| `fuel_type` | `diesel`, `gasoline`, `electric` |
| `trip_status` | `planned`, `loading`, `loaded`, `in_transit`, `arrived`, `delivering`, `delivered`, `completed`, `cancelled`, `disputed` |
| `parcel_status` | `active`, `inactive` |
| `consumable_type` | `twine`, `net_wrap`, `silage_film`, `other` |
| `document_type` | `cmr`, `invoice`, `delivery_note`, `weight_ticket`, `report` |
| `document_status` | `pending`, `generating`, `generated`, `sent`, `failed` |
| `alert_category` | `fraud`, `anomaly`, `maintenance`, `safety`, `system` |
| `alert_severity` | `low`, `medium`, `high`, `critical` |
| `audit_operation` | `insert`, `update`, `delete` |
| `assignment_priority` | `low`, `normal`, `high`, `urgent` |
| `task_assignment_status` | `available`, `in_progress`, `done` |
| `harvest_status` | `planned`, `to_harvest`, `harvesting`, `harvested` |

## Tables

### Core Tables (00002)

**users**: `id` (UUID PK), `email` (UNIQUE), `phone`, `full_name`, `role` (user_role, default `driver`), `password_hash`, `is_active`, `locale` (default `en`), `avatar_url`, `last_login_at`, `assigned_machine_id` (FK machines, added 00011), `notification_prefs` (JSONB, added 00021), timestamps, `deleted_at`.

**parcels**: `id` (UUID PK), `code` (UNIQUE), `name` (nullable per 00010), `owner_name`, `owner_contact`, `area_hectares` (NUMERIC 10,2), `boundary` (GEOMETRY Polygon 4326), `centroid` (GEOMETRY Point 4326), `address`, `municipality`, `farmtrack_geofence_id`, `farm_id` (FK farms, added 00014), `harvest_status` (added 00017, default `planned`), `notes`, `is_active`, timestamps, `deleted_at`.

**machines**: `id` (UUID PK), `machine_type`, `registration_plate`, `internal_code` (UNIQUE), `make`, `model`, `year`, `fuel_type`, `tank_capacity_liters`, `farmtrack_device_id`, `current_odometer_km` (default 0), `current_hourmeter_hrs` (default 0), `is_active`, `max_payload_kg`, `max_bale_count`, `tare_weight_kg`, `bales_per_hour_avg`, `bale_weight_avg_kg`, `reach_meters`, timestamps, `deleted_at`.

**delivery_destinations**: `id`, `code` (UNIQUE), `name`, `address`, `coords` (GEOMETRY Point 4326), `contact_name`, `contact_phone`, `contact_email`, `boundary` (GEOMETRY Polygon 4326, added 00018), `is_active`, timestamps, `deleted_at`.

### Operations Tables (00003)

**task_assignments**: `id`, `assignment_date` (DATE), `machine_id` (FK), `parcel_id` (FK, nullable), `assigned_user_id` (FK, nullable), `priority` (default `normal`), `sequence_order` (INT), `status` (task_assignment_status, default `available`, added 00015), `parent_assignment_id` (FK self, added 00015), `destination_id` (FK delivery_destinations, added 00018), timestamps, `deleted_at`. Unique constraint: `(assignment_date, machine_id, sequence_order)` among non-deleted rows only (partial unique index, 00020).

**trips**: `id`, `trip_number` (UNIQUE), `status` (default `planned`), `source_parcel_id` (FK), `source_parcel_auto`, `loader_id` (FK machines), `truck_id` (FK machines, NOT NULL), `loader_operator_id` (FK users), `driver_id` (FK users, NOT NULL), `bale_count` (default 0), phase timestamps, odometer fields, `gps_distance_km`, destination info, weight fields, `net_weight_kg` (**GENERATED** = gross - tare), `odometer_distance_km` (**GENERATED** = arrival - departure), `distance_discrepancy_km`, `fraud_flags` (JSONB), `client_id`, `sync_version` (BIGINT default 1), timestamps, `deleted_at`.

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

**farms** (00014): `id`, `name` (NOT NULL), `address`, timestamps, `deleted_at`.

**parcel_daily_status** (00015): `id`, `parcel_id` (FK NOT NULL), `status_date` (DATE), `is_done`, `notes`, timestamps. UNIQUE `(parcel_id, status_date)`.

**device_push_tokens** (00019): `id`, `user_id` (FK NOT NULL), `machine_id` (FK), `token`, `platform` (default `android`), `is_active`, timestamps. UNIQUE `(user_id, token)`.

**geofence_events** (00019): `id`, `machine_id` (FK NOT NULL), `assignment_id` (FK), `geofence_type`, `geofence_id`, `event_type`, `lat`, `lon`, `created_at`.

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

## Indexes (00006, 00009, 00012, 00014, 00015, 00018, 00019, 00024)

Key partial indexes (00024, filter `deleted_at IS NULL`):
- `idx_trips_status_active`, `idx_trips_driver_active`, `idx_trips_created_active`

Spatial (GIST): `idx_parcels_boundary`, `idx_parcels_centroid`, `idx_mle_coords`, `idx_delivery_destinations_boundary`

Composite: `idx_mle_machine_recorded (machine_id, recorded_at ASC)`, `idx_task_assignments_status (assignment_date, status) WHERE deleted_at IS NULL`

## Triggers (00007, 00023)

### `set_updated_at()` -- Auto-update `updated_at` on every UPDATE
Applied to: `users`, `parcels`, `machines`, `delivery_destinations`, `task_assignments`, `trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `documents`, `alerts`.

### `audit_trigger_func()` -- Generic audit logging (AFTER INSERT/UPDATE/DELETE)
Applied to: `trips`, `bale_loads`, `bale_productions`, `fuel_logs`, `consumable_logs`, `machines`, `parcels`, `task_assignments`, `users`, `delivery_destinations`, `documents` (expanded in 00023 to include DELETE and more tables).

Extracts `user_id` from JWT claims. Extracts `client_id` from the record's own column (for offline sync attribution). Skips audit if UPDATE changes no fields.

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

## Auto-increment Sequence (00010)

`parcels_code_seq` -- generates readable parcel codes like `P-0001`.

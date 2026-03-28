-- 00009_roles_gps.sql
-- 1. Replace user_role enum: remove 'dispatcher', add 'baler_operator'.
-- 2. Add machine_location_events table for phone-based GPS tracking.
-- 3. Update RLS policies accordingly.
-- 4. FarmTrack columns (farmtrack_device_id, farmtrack_geofence_id, etc.) are left
--    nullable as they are — removing them is a separate destructive migration.

-- ============================================================
-- 1. Update user_role enum
-- PostgreSQL cannot drop enum values directly.
-- Strategy: rename old type, create new, cast column, drop old.
-- ============================================================

-- Migrate any existing 'dispatcher' users to 'driver' before type change.
UPDATE public.users SET role = 'driver' WHERE role = 'dispatcher';

-- Rename existing enum so we can reuse the name.
ALTER TYPE user_role RENAME TO user_role_old;

-- Create the new enum with baler_operator, without dispatcher.
CREATE TYPE user_role AS ENUM ('admin', 'baler_operator', 'loader_operator', 'driver');

-- Migrate the column on users table.
ALTER TABLE public.users
  ALTER COLUMN role TYPE user_role
  USING role::text::user_role;

-- Drop the old enum.
DROP TYPE user_role_old;

-- Update the default so it still compiles.
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'driver';

-- ============================================================
-- 2. machine_location_events table
-- Stores GPS pings sent from operator mobile devices.
-- ============================================================
CREATE TABLE machine_location_events (
  id           UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id   UUID             REFERENCES machines(id) ON DELETE SET NULL,
  operator_id  UUID             REFERENCES users(id)    ON DELETE SET NULL,
  lat          NUMERIC(10, 7)   NOT NULL,
  lon          NUMERIC(10, 7)   NOT NULL,
  coords       GEOMETRY(Point, 4326) GENERATED ALWAYS AS
                 (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED,
  accuracy_m   NUMERIC(6, 2),
  heading_deg  NUMERIC(5, 2),
  speed_ms     NUMERIC(6, 2),
  recorded_at  TIMESTAMPTZ      NOT NULL,
  created_at   TIMESTAMPTZ      DEFAULT now()
);

-- Indexes for efficient spatial + time-series queries.
CREATE INDEX idx_mle_machine_id   ON machine_location_events (machine_id);
CREATE INDEX idx_mle_operator_id  ON machine_location_events (operator_id);
CREATE INDEX idx_mle_recorded_at  ON machine_location_events (recorded_at DESC);
CREATE INDEX idx_mle_coords       ON machine_location_events USING GIST (coords);

-- ============================================================
-- 3. RLS on machine_location_events
-- ============================================================
ALTER TABLE machine_location_events ENABLE ROW LEVEL SECURITY;

-- Admin sees everything.
CREATE POLICY mle_admin_all ON machine_location_events
  FOR ALL
  USING (public.user_role() = 'admin')
  WITH CHECK (public.user_role() = 'admin');

-- Each operator can read/insert their own location events.
CREATE POLICY mle_operator_own ON machine_location_events
  FOR ALL
  USING (operator_id = public.user_id())
  WITH CHECK (operator_id = public.user_id());

-- ============================================================
-- 4. Drop old dispatcher RLS policies from 00008.
--    The policies reference the 'dispatcher' literal which no longer
--    exists in the enum — keep them as DROP IF EXISTS to be safe.
-- ============================================================
DROP POLICY IF EXISTS dispatcher_read_users            ON users;
DROP POLICY IF EXISTS dispatcher_read_parcels          ON parcels;
DROP POLICY IF EXISTS dispatcher_read_machines         ON machines;
DROP POLICY IF EXISTS dispatcher_read_delivery_dest    ON delivery_destinations;
DROP POLICY IF EXISTS dispatcher_read_trips            ON trips;
DROP POLICY IF EXISTS dispatcher_read_bale_loads       ON bale_loads;
DROP POLICY IF EXISTS dispatcher_read_bale_productions ON bale_productions;
DROP POLICY IF EXISTS dispatcher_read_fuel_logs        ON fuel_logs;
DROP POLICY IF EXISTS dispatcher_read_consumable_logs  ON consumable_logs;
DROP POLICY IF EXISTS dispatcher_read_documents        ON documents;
DROP POLICY IF EXISTS dispatcher_read_alerts           ON alerts;
DROP POLICY IF EXISTS dispatcher_crud_task_assignments ON task_assignments;
DROP POLICY IF EXISTS dispatcher_update_trips          ON trips;
DROP POLICY IF EXISTS dispatcher_insert_trips          ON trips;

-- ============================================================
-- 5. Add baler_operator RLS policies.
--    Balers load bales (bale_productions), read parcels/machines.
-- ============================================================
-- Read reference data.
CREATE POLICY baler_op_read_parcels  ON parcels  FOR SELECT USING (public.user_role() = 'baler_operator');
CREATE POLICY baler_op_read_machines ON machines FOR SELECT USING (public.user_role() = 'baler_operator');

-- Read own task assignments.
CREATE POLICY baler_op_read_own_assignments ON task_assignments
  FOR SELECT USING (
    public.user_role() = 'baler_operator'
    AND assigned_user_id = public.user_id()
  );

-- CRUD own bale_productions.
CREATE POLICY baler_op_crud_bale_productions ON bale_productions
  FOR ALL
  USING (public.user_role() = 'baler_operator' AND operator_id = public.user_id())
  WITH CHECK (public.user_role() = 'baler_operator' AND operator_id = public.user_id());

-- CRUD own fuel_logs.
CREATE POLICY baler_op_crud_fuel_logs ON fuel_logs
  FOR ALL
  USING (public.user_role() = 'baler_operator' AND operator_id = public.user_id())
  WITH CHECK (public.user_role() = 'baler_operator' AND operator_id = public.user_id());

-- 00008_rls_policies.sql
-- Row-Level Security policies for all tables.

-- ============================================================
-- Helper functions to extract user info from JWT
-- ============================================================
CREATE OR REPLACE FUNCTION auth.user_role() RETURNS user_role AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'role')::user_role;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bale_loads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bale_productions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE farmtrack_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_idempotency     ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ADMIN — full CRUD on everything
-- ============================================================
CREATE POLICY admin_all_users               ON users                FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_parcels             ON parcels              FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_machines            ON machines             FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_delivery_dest       ON delivery_destinations FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_task_assignments    ON task_assignments     FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_trips               ON trips                FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_bale_loads          ON bale_loads           FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_bale_productions    ON bale_productions     FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_fuel_logs           ON fuel_logs            FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_consumable_logs     ON consumable_logs      FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_documents           ON documents            FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_alerts              ON alerts               FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_farmtrack_events    ON farmtrack_events     FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY admin_all_sync_idempotency    ON sync_idempotency     FOR ALL USING (auth.user_role() = 'admin') WITH CHECK (auth.user_role() = 'admin');

-- Admin read-only on audit_logs (writes are trigger-only)
CREATE POLICY admin_read_audit_logs ON audit_logs FOR SELECT USING (auth.user_role() = 'admin');

-- ============================================================
-- DISPATCHER — CRUD task_assignments, read all reference data,
--              update trip status
-- ============================================================
-- Read access to reference/operational tables
CREATE POLICY dispatcher_read_users            ON users                FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_parcels          ON parcels              FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_machines         ON machines             FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_delivery_dest    ON delivery_destinations FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_trips            ON trips                FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_bale_loads       ON bale_loads           FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_bale_productions ON bale_productions     FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_fuel_logs        ON fuel_logs            FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_consumable_logs  ON consumable_logs      FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_documents        ON documents            FOR SELECT USING (auth.user_role() = 'dispatcher');
CREATE POLICY dispatcher_read_alerts           ON alerts               FOR SELECT USING (auth.user_role() = 'dispatcher');

-- CRUD on task_assignments
CREATE POLICY dispatcher_crud_task_assignments ON task_assignments
  FOR ALL USING (auth.user_role() = 'dispatcher')
  WITH CHECK (auth.user_role() = 'dispatcher');

-- Update trip status (dispatchers can manage trip lifecycle)
CREATE POLICY dispatcher_update_trips ON trips
  FOR UPDATE USING (auth.user_role() = 'dispatcher')
  WITH CHECK (auth.user_role() = 'dispatcher');

-- Dispatchers can create trips
CREATE POLICY dispatcher_insert_trips ON trips
  FOR INSERT WITH CHECK (auth.user_role() = 'dispatcher');

-- ============================================================
-- LOADER OPERATOR — read parcels/machines/own assignments,
--                   CRUD own bale_loads/fuel_logs,
--                   update trips in loading phase where they are the operator
-- ============================================================
CREATE POLICY loader_op_read_parcels  ON parcels  FOR SELECT USING (auth.user_role() = 'loader_operator');
CREATE POLICY loader_op_read_machines ON machines FOR SELECT USING (auth.user_role() = 'loader_operator');

CREATE POLICY loader_op_read_own_assignments ON task_assignments
  FOR SELECT USING (auth.user_role() = 'loader_operator' AND assigned_user_id = auth.user_id());

-- Read trips where they are the loader operator
CREATE POLICY loader_op_read_own_trips ON trips
  FOR SELECT USING (auth.user_role() = 'loader_operator' AND loader_operator_id = auth.user_id());

-- CRUD own bale_loads
CREATE POLICY loader_op_crud_bale_loads ON bale_loads
  FOR ALL USING (auth.user_role() = 'loader_operator' AND operator_id = auth.user_id())
  WITH CHECK (auth.user_role() = 'loader_operator' AND operator_id = auth.user_id());

-- CRUD own fuel_logs
CREATE POLICY loader_op_crud_fuel_logs ON fuel_logs
  FOR ALL USING (auth.user_role() = 'loader_operator' AND operator_id = auth.user_id())
  WITH CHECK (auth.user_role() = 'loader_operator' AND operator_id = auth.user_id());

-- Update trips in loading phase where they are the loader_operator
CREATE POLICY loader_op_update_loading_trips ON trips
  FOR UPDATE USING (
    auth.user_role() = 'loader_operator'
    AND loader_operator_id = auth.user_id()
    AND status IN ('loading', 'loaded')
  )
  WITH CHECK (
    auth.user_role() = 'loader_operator'
    AND loader_operator_id = auth.user_id()
  );

-- ============================================================
-- DRIVER — read parcels/machines/own assignments,
--          update own trips in transit + delivery phases,
--          CRUD own fuel_logs
-- ============================================================
CREATE POLICY driver_read_parcels  ON parcels  FOR SELECT USING (auth.user_role() = 'driver');
CREATE POLICY driver_read_machines ON machines FOR SELECT USING (auth.user_role() = 'driver');

CREATE POLICY driver_read_delivery_dest ON delivery_destinations
  FOR SELECT USING (auth.user_role() = 'driver');

CREATE POLICY driver_read_own_assignments ON task_assignments
  FOR SELECT USING (auth.user_role() = 'driver' AND assigned_user_id = auth.user_id());

-- Read own trips
CREATE POLICY driver_read_own_trips ON trips
  FOR SELECT USING (auth.user_role() = 'driver' AND driver_id = auth.user_id());

-- Update own trips in transit + delivery phases
CREATE POLICY driver_update_own_trips ON trips
  FOR UPDATE USING (
    auth.user_role() = 'driver'
    AND driver_id = auth.user_id()
    AND status IN ('in_transit', 'arrived', 'delivering', 'delivered')
  )
  WITH CHECK (
    auth.user_role() = 'driver'
    AND driver_id = auth.user_id()
  );

-- CRUD own fuel_logs
CREATE POLICY driver_crud_fuel_logs ON fuel_logs
  FOR ALL USING (auth.user_role() = 'driver' AND operator_id = auth.user_id())
  WITH CHECK (auth.user_role() = 'driver' AND operator_id = auth.user_id());

-- Driver can read own bale_loads (for trip details)
CREATE POLICY driver_read_own_bale_loads ON bale_loads
  FOR SELECT USING (
    auth.user_role() = 'driver'
    AND trip_id IN (SELECT id FROM trips WHERE driver_id = auth.user_id())
  );

-- Driver can read documents for own trips
CREATE POLICY driver_read_own_documents ON documents
  FOR SELECT USING (
    auth.user_role() = 'driver'
    AND trip_id IN (SELECT id FROM trips WHERE driver_id = auth.user_id())
  );

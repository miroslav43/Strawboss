-- 00050_drop_odometer.sql
-- Remove the odometer subsystem entirely — distance is now GPS-only
-- (machine_location_events trace + trips.gps_distance_km). Drops every odometer
-- column/constraint from trips, fuel_logs and machines.
--
-- KEPT (NOT odometer): trips.gps_distance_km, fuel_logs.hourmeter_hrs,
-- machines.current_hourmeter_hrs — engine-hours/GPS distance are unrelated.
--
-- Idempotent: every drop is guarded with IF EXISTS, so re-runs are no-ops.
-- Order matters on trips: the generated column odometer_distance_km depends on
-- departure/arrival readings, so it must be dropped before its source columns.

-- ── trips ────────────────────────────────────────────────────────────────
ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_odometer_order;
ALTER TABLE trips DROP COLUMN IF EXISTS odometer_distance_km;   -- generated
ALTER TABLE trips DROP COLUMN IF EXISTS distance_discrepancy_km;
ALTER TABLE trips DROP COLUMN IF EXISTS departure_odometer_km;
ALTER TABLE trips DROP COLUMN IF EXISTS arrival_odometer_km;

-- ── fuel_logs ────────────────────────────────────────────────────────────
ALTER TABLE fuel_logs DROP COLUMN IF EXISTS odometer_km;

-- ── machines ─────────────────────────────────────────────────────────────
ALTER TABLE machines DROP COLUMN IF EXISTS current_odometer_km;

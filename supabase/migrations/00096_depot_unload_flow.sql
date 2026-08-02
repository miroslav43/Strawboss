-- 00096_depot_unload_flow.sql
-- Two-step depot unloading (operator depozit).
--
-- Until now the depot operator's confirmation was a single action that
-- collapsed arrived|delivering -> completed, so the driver waiting at the ramp
-- had no way of knowing whether anyone had even started on him: his screen sat
-- on a mute hourglass from arrival until the trip closed. The flow is now
-- "Începe descărcarea" -> "Finalizează", and these two columns are what the
-- driver's phone reads to render the middle state.
--
--  * depot_unload_started_at            -- stamped by POST /trips/:id/start-depot-unload
--  * depot_confirm_location_unverified  -- the operator confirmed a truck whose GPS
--                                          could not be checked against the depot
--                                          perimeter (dead phone / stale fix) and
--                                          explicitly accepted the override.
--
-- The unverified flag mirrors bale_loads.location_unverified (00094): the
-- server-side geofence stays enforced by default and is only bypassed when the
-- operator says "camionul e aici" — the row is then flagged for admin review
-- instead of looking identical to a GPS-verified confirmation. Authorization is
-- untouched: the operator must still be assigned to that depot.
--
-- Default false / NULL = today's behaviour for every existing row. Idempotent.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS depot_unload_started_at TIMESTAMPTZ;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS depot_confirm_location_unverified BOOLEAN NOT NULL DEFAULT false;

-- Partial index: the only query that reads this column is the admin review of
-- overridden confirmations, which wants the (rare) true rows exclusively.
CREATE INDEX IF NOT EXISTS idx_trips_depot_confirm_unverified
  ON trips (depot_confirm_location_unverified)
  WHERE deleted_at IS NULL AND depot_confirm_location_unverified = true;

COMMENT ON COLUMN trips.depot_unload_started_at IS
  'When the depot operator pressed "Începe descărcarea" (step 1 of the manned-depot flow). NULL = not started.';
COMMENT ON COLUMN trips.depot_confirm_location_unverified IS
  'The depot operator confirmed this delivery with the truck GPS stale or outside confirm_radius_m, using the explicit override. Mirrors bale_loads.location_unverified.';

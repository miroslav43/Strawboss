-- 00094_bale_loads_location_unverified.sql
-- Marks a bale_load whose in-field GPS presence could NOT be verified at
-- registration time (offline, or the field's geometry wasn't cached yet on
-- the phone) but was registered anyway after the operator explicitly
-- confirmed the "position unverified" prompt on mobile. The load's own
-- gps_lat/gps_lon are still recorded — this flag only says "we couldn't check
-- them against the field boundary when this was written", so the row can
-- surface for admin review instead of looking identical to a verified load.
-- Default false = today's behaviour for every existing/future row that never
-- hits the degraded path. Idempotent.

ALTER TABLE bale_loads
  ADD COLUMN IF NOT EXISTS location_unverified BOOLEAN NOT NULL DEFAULT false;

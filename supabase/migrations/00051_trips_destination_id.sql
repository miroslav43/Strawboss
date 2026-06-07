-- 00051_trips_destination_id.sql
-- Add the delivery-destination FK to `trips`. The sync pull column list
-- (PULL_COLUMNS.trips), the depot-manager owner filter, and the mobile
-- LocalTrip schema all already reference `trips.destination_id`, but the column
-- was never created (00018 only added destination_id to task_assignments). Its
-- absence makes EVERY /sync/pull for trips fail with
-- `column "destination_id" does not exist`, so drivers can't fetch their trips.
--
-- Mirrors task_assignments.destination_id (00018). Idempotent: IF NOT EXISTS
-- guards re-runs.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS destination_id UUID REFERENCES delivery_destinations(id);

-- Partial index for the depot-manager owner filter (trips going to a depot).
CREATE INDEX IF NOT EXISTS idx_trips_destination
  ON trips (destination_id)
  WHERE deleted_at IS NULL AND destination_id IS NOT NULL;

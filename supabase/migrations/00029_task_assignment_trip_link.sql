-- 00029_task_assignment_trip_link.sql
-- Link truck task_assignments to auto-created trips so admin planning
-- transparently materializes Trip rows (Option B).

ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id);

CREATE INDEX IF NOT EXISTS idx_task_assignments_trip
  ON task_assignments (trip_id)
  WHERE deleted_at IS NULL AND trip_id IS NOT NULL;

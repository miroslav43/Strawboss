-- Composite index for efficient route history queries:
-- WHERE machine_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at ASC
CREATE INDEX IF NOT EXISTS idx_mle_machine_recorded
  ON machine_location_events (machine_id, recorded_at ASC);

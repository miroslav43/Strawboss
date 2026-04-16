-- Replace full indexes with partial indexes that filter soft-deleted rows
DROP INDEX IF EXISTS idx_trips_status;
CREATE INDEX IF NOT EXISTS idx_trips_status_active ON trips (status) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_trips_driver_id;
CREATE INDEX IF NOT EXISTS idx_trips_driver_active ON trips (driver_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_created_active ON trips (created_at DESC) WHERE deleted_at IS NULL;

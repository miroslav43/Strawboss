-- Add geofence boundary to delivery_destinations (like parcels)
ALTER TABLE delivery_destinations
  ADD COLUMN IF NOT EXISTS boundary GEOMETRY(Polygon, 4326);

-- Add destination FK to task_assignments (for truck → deposit routing)
ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS destination_id UUID REFERENCES delivery_destinations(id);

-- Spatial index on deposit boundaries for geofence queries
CREATE INDEX IF NOT EXISTS idx_delivery_destinations_boundary
  ON delivery_destinations USING GIST (boundary) WHERE boundary IS NOT NULL;

-- Index on task_assignments destination_id
CREATE INDEX IF NOT EXISTS idx_task_assignments_destination
  ON task_assignments (destination_id) WHERE deleted_at IS NULL AND destination_id IS NOT NULL;

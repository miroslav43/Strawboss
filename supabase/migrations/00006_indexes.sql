-- 00006_indexes.sql
-- Performance indexes for common query patterns.

-- ============================================================
-- trips
-- ============================================================
CREATE INDEX idx_trips_status          ON trips (status);
CREATE INDEX idx_trips_driver_id       ON trips (driver_id);
CREATE INDEX idx_trips_truck_id        ON trips (truck_id);
CREATE INDEX idx_trips_source_parcel   ON trips (source_parcel_id);
CREATE INDEX idx_trips_trip_number     ON trips (trip_number);
CREATE INDEX idx_trips_created_at      ON trips (created_at);

-- ============================================================
-- bale_loads
-- ============================================================
CREATE INDEX idx_bale_loads_trip_id    ON bale_loads (trip_id);
CREATE INDEX idx_bale_loads_parcel_id  ON bale_loads (parcel_id);

-- ============================================================
-- bale_productions
-- ============================================================
CREATE INDEX idx_bale_productions_parcel_id       ON bale_productions (parcel_id);
CREATE INDEX idx_bale_productions_production_date ON bale_productions (production_date);

-- ============================================================
-- fuel_logs
-- ============================================================
CREATE INDEX idx_fuel_logs_machine_id  ON fuel_logs (machine_id);
CREATE INDEX idx_fuel_logs_logged_at   ON fuel_logs (logged_at);

-- ============================================================
-- task_assignments
-- ============================================================
CREATE INDEX idx_task_assignments_date       ON task_assignments (assignment_date);
CREATE INDEX idx_task_assignments_machine    ON task_assignments (machine_id);
CREATE INDEX idx_task_assignments_user       ON task_assignments (assigned_user_id);

-- ============================================================
-- alerts
-- ============================================================
CREATE INDEX idx_alerts_category        ON alerts (category);
CREATE INDEX idx_alerts_severity        ON alerts (severity);
CREATE INDEX idx_alerts_acknowledged    ON alerts (is_acknowledged);

-- ============================================================
-- audit_logs
-- ============================================================
CREATE INDEX idx_audit_logs_table_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_created_at   ON audit_logs (created_at);

-- ============================================================
-- farmtrack_events
-- ============================================================
CREATE INDEX idx_farmtrack_events_device_id  ON farmtrack_events (device_id);
CREATE INDEX idx_farmtrack_events_machine_id ON farmtrack_events (machine_id);
CREATE INDEX idx_farmtrack_events_timestamp  ON farmtrack_events (timestamp);

-- ============================================================
-- parcels  (spatial)
-- ============================================================
CREATE INDEX idx_parcels_boundary ON parcels USING GIST (boundary);
CREATE INDEX idx_parcels_centroid ON parcels USING GIST (centroid);

-- ============================================================
-- machines
-- ============================================================
CREATE INDEX idx_machines_type      ON machines (machine_type);
CREATE INDEX idx_machines_is_active ON machines (is_active);

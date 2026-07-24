-- 00091_parcel_cross_org_fk_hardening.sql
-- Cross-org hardening for every parcel reference, mirroring what
-- 00070_trip_request_source_depot.sql already did for delivery_destinations.
-- Flagged by an automated review: trip_requests.source_parcel_id (00090) had no
-- composite FK, unlike source_depot_id — and neither did any OTHER parcel_id
-- reference in the schema (trips, bale_loads, task_assignments), all added long
-- before this hardening pattern existed. Verified zero existing violations
-- across all four tables before writing this, so a plain composite FK (not
-- NOT VALID) is safe. Additive only — existing single-column FKs are untouched.
-- MATCH SIMPLE (default) → a NULL parcel reference is unchecked, which is
-- required since every one of these columns is nullable (XOR'd with a depot
-- or absent entirely). Idempotent.

-- 1) Composite unique target on parcels (an FK needs a unique key).
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_org_id_key;
ALTER TABLE parcels
  ADD CONSTRAINT parcels_org_id_key UNIQUE (organization_id, id);

-- 2) trip_requests.source_parcel_id
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_source_parcel_org_fkey;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_source_parcel_org_fkey
  FOREIGN KEY (organization_id, source_parcel_id)
  REFERENCES parcels (organization_id, id);

-- 3) trips.source_parcel_id
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_source_parcel_org_fkey;
ALTER TABLE trips
  ADD CONSTRAINT trips_source_parcel_org_fkey
  FOREIGN KEY (organization_id, source_parcel_id)
  REFERENCES parcels (organization_id, id);

-- 4) bale_loads.parcel_id
ALTER TABLE bale_loads DROP CONSTRAINT IF EXISTS bale_loads_parcel_org_fkey;
ALTER TABLE bale_loads
  ADD CONSTRAINT bale_loads_parcel_org_fkey
  FOREIGN KEY (organization_id, parcel_id)
  REFERENCES parcels (organization_id, id);

-- 5) task_assignments.parcel_id
ALTER TABLE task_assignments DROP CONSTRAINT IF EXISTS task_assignments_parcel_org_fkey;
ALTER TABLE task_assignments
  ADD CONSTRAINT task_assignments_parcel_org_fkey
  FOREIGN KEY (organization_id, parcel_id)
  REFERENCES parcels (organization_id, id);

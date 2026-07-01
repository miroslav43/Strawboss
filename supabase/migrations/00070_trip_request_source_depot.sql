-- 00070_trip_request_source_depot.sql
-- The pickup SOURCE depot chosen by the dispatcher when confirming a trip request
-- (the depozit the driver loads from). Nullable; cross-org composite FK mirrors the
-- hardening in 00063 so a request can only reference a depot in its OWN org.
-- Idempotent.

-- 1) Composite unique target on delivery_destinations (an FK needs a unique key).
ALTER TABLE delivery_destinations DROP CONSTRAINT IF EXISTS delivery_destinations_org_id_key;
ALTER TABLE delivery_destinations
  ADD CONSTRAINT delivery_destinations_org_id_key UNIQUE (organization_id, id);

-- 2) The new column + cross-org composite FK (MATCH SIMPLE → null rows unchecked).
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS source_depot_id UUID;

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_source_depot_org_fkey;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_source_depot_org_fkey
  FOREIGN KEY (organization_id, source_depot_id)
  REFERENCES delivery_destinations (organization_id, id);

-- 00090_trip_request_source_parcel.sql
-- Sibling to 00070_trip_request_source_depot.sql: a confirmed trip_request may
-- instead source directly from a field. Nullable; the app layer (not the DB)
-- enforces "confirm requires exactly one of depotId/parcelId" via
-- confirmTripRequestSchema, same as source_depot_id today. Idempotent.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS source_parcel_id UUID REFERENCES parcels(id);

CREATE INDEX IF NOT EXISTS idx_trip_requests_source_parcel
  ON trip_requests (source_parcel_id)
  WHERE source_parcel_id IS NOT NULL;

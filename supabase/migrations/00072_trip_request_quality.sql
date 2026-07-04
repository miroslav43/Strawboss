-- 00072_trip_request_quality.sql
-- The beneficiary request portal replaces the free crop-type pick with a fixed
-- QUALITY grade (quality_1 / quality_2). Stored here so the office sees it on the
-- request card + new-request email. Nullable: legacy rows and the non-beneficiary
-- public portal never set it.
-- Idempotent.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS quality TEXT;

-- Constrain to the two known grades. Re-create so re-running stays clean.
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_quality_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_quality_check
  CHECK (quality IS NULL OR quality IN ('quality_1', 'quality_2'));

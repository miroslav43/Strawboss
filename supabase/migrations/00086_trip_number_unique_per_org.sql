-- 00086_trip_number_unique_per_org.sql
-- P0: the second organization cannot create ANY trip.
--
-- `trips.trip_number` carried a GLOBALLY unique index (trips_trip_number_key, from
-- the original 00003 CREATE TABLE, before multi-tenancy existed). But
-- TripsService.generateTripNumber() mints the number by counting PER ORGANIZATION:
--
--     SELECT COUNT(*) FROM trips
--      WHERE trip_number LIKE 'TR-<yyyymmdd>-%' AND organization_id = <caller org>
--
-- So on any day where org A has already created a trip, org B counts its own 0
-- trips, mints TR-<date>-001 — and collides with org A's row:
--
--     duplicate key value violates unique constraint "trips_trip_number_key"
--
-- Observed in production 2026-07-14: StrawBoss held TR-20260714-001..003, and every
-- truck-task assignment in AgroBrothers failed. It fails for the whole day, every
-- day, for whichever org is not first — a silent multi-tenant outage that has been
-- latent since organizations were introduced (00036).
--
-- FIX: scope uniqueness the same way the generator scopes counting. Each company
-- gets its own sequence, so StrawBoss and AgroBrothers may both hold
-- TR-20260714-001. That is the correct model, not a compromise: the trip number is
-- printed on the CMR, and a CMR belongs to a company.
--
-- No application change is needed. generateTripNumber() is already per-org; it
-- simply becomes CORRECT once the constraint agrees with it.
--
-- SAFE BY CONSTRUCTION. The new constraint is strictly MORE PERMISSIVE than the one
-- it replaces (every globally-unique set is also unique per-org), so it cannot fail
-- on existing rows. `organization_id` is NOT NULL (00036), so there are no
-- NULL-key surprises — a NULL would make rows mutually non-conflicting and silently
-- weaken the guarantee.
--
-- Idempotent: re-running is a no-op.

-- Drop the global uniqueness. It is the bug, not a safety net: it enforces a
-- cross-tenant invariant nobody wants (two unrelated companies may not share a
-- trip number) while failing to enforce the one that matters.
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_trip_number_key;

-- ...and scope it to the organization, matching the generator.
DO $$
BEGIN
  ALTER TABLE trips
    ADD CONSTRAINT trips_trip_number_org_key UNIQUE (organization_id, trip_number);
EXCEPTION
  WHEN duplicate_table  THEN RAISE NOTICE 'trips_trip_number_org_key already exists, skipping.';
  WHEN duplicate_object THEN RAISE NOTICE 'trips_trip_number_org_key already exists, skipping.';
END $$;

-- The plain lookup index (00006) stays: trip numbers are searched by value, and the
-- new composite is keyed (organization_id, trip_number) so it cannot serve a
-- trip_number-only probe.
CREATE INDEX IF NOT EXISTS idx_trips_trip_number ON trips (trip_number);

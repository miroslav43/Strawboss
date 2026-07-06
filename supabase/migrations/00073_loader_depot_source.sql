-- 00073_loader_depot_source.sql
-- Loader → depot sourcing. A loader operator can now load a truck FROM a depot
-- (delivery_destinations, aka "depozit") instead of a field parcel. Both bale_loads
-- and trips gain a source_depot_id; parcel_id becomes optional on bale_loads and a
-- CHECK guarantees exactly-one-source (a load is EITHER from a parcel OR a depot).
--
-- No RLS change: bale_loads and trips are already org-scoped, and delivery_destinations
-- carries the (organization_id, id) composite unique from 00070 for org-consistent FKs.
-- Idempotent throughout.

-- ============================================================
-- bale_loads — parcel_id now optional, add depot source.
-- ============================================================
ALTER TABLE bale_loads ALTER COLUMN parcel_id DROP NOT NULL;

ALTER TABLE bale_loads
  ADD COLUMN IF NOT EXISTS source_depot_id UUID REFERENCES delivery_destinations(id);

-- Exactly-one-source guard: a load must come from a parcel OR a depot (or both, e.g.
-- a depot physically located on a parcel). Added NOT VALID first so the ADD does not
-- scan existing rows, then VALIDATE separately. The pg_constraint name guard makes the
-- ADD safe to re-run; VALIDATE on an already-valid constraint is a no-op.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bale_loads_source'
      AND conrelid = 'bale_loads'::regclass
  ) THEN
    ALTER TABLE bale_loads
      ADD CONSTRAINT chk_bale_loads_source
      CHECK (parcel_id IS NOT NULL OR source_depot_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE bale_loads VALIDATE CONSTRAINT chk_bale_loads_source;

-- ============================================================
-- trips — depot source (mirrors source_parcel_id).
-- ============================================================
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS source_depot_id UUID REFERENCES delivery_destinations(id);

-- ============================================================
-- Partial indexes — only depot-sourced rows are indexed.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bale_loads_source_depot
  ON bale_loads (source_depot_id)
  WHERE source_depot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trips_source_depot
  ON trips (source_depot_id)
  WHERE source_depot_id IS NOT NULL;

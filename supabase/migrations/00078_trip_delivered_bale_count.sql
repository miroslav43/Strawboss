-- Reconciliation bug: reconcileBalesForParcel's "delivered" sum used
-- trips.bale_count for delivered/completed trips, but on the non-depot driver
-- path (TripsService.confirmDelivery) bale_count is never adjusted for
-- damage/loss recorded via deteriorated_bales_count — so deliveredVsLoadedDiff
-- was always 0 even when bales were damaged/lost in transit. The depot path
-- already reuses bale_count correctly: confirmDepotDelivery overwrites it with
-- the operator-confirmed count (see 00053_depot_confirmation.sql's comment),
-- so this column only needs to be populated on the driver (non-depot) path.
--
-- Idempotent throughout.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS delivered_bale_count INTEGER;

DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT chk_delivered_bale_count_nonneg
    CHECK (delivered_bale_count IS NULL OR delivered_bale_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN trips.delivered_bale_count IS
  'Bales actually delivered on the driver (non-depot) confirm-delivery path: bale_count - deteriorated_bales_count. NULL for depot-confirmed trips (which reuse bale_count directly, per 00053) and for trips predating this column — reconciliation falls back to bale_count via COALESCE when NULL.';

-- Backfill existing delivered/completed non-depot trips so historical
-- reconciliation reflects known damage/loss instead of relying on the
-- COALESCE fallback forever. Depot-confirmed trips (depot_operator_id set)
-- are left NULL — they already carry the correct count in bale_count itself.
UPDATE trips
   SET delivered_bale_count = GREATEST(bale_count - COALESCE(deteriorated_bales_count, 0), 0)
 WHERE status IN ('delivered', 'completed')
   AND depot_operator_id IS NULL
   AND deleted_at IS NULL
   AND delivered_bale_count IS NULL;

-- No sync_version bump needed here — the existing set_sync_version trigger
-- (00040) stamps it automatically whenever confirmDelivery's UPDATE writes
-- this column. Not mobile-synced (mobile never reads delivered_bale_count);
-- the column inherits trips' existing RLS policies.

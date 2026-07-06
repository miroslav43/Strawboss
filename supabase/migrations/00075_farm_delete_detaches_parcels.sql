-- 00075_farm_delete_detaches_parcels.sql
-- When a FARM is soft-deleted, DETACH its parcels (farm_id -> NULL) instead of
-- leaving them dangling. A parcel is physical land; it must survive the deletion
-- of the farm entity that merely grouped it, moving to the "Fără fermă" /
-- unassigned bucket — exactly the state the Ferme page already renders.
--
-- Bug this fixes: FarmsService.softDelete only set farms.deleted_at and never
-- touched the parcels. The Ferme page filters `deleted_at IS NULL` so the farm
-- vanished there, but the machine-plan farm→parcel cascade (and the mobile
-- "Teren activ" card) rebuild the farm list from the parcels' *denormalized*
-- farm_id / farm_name, so the deleted farm lingered as a GHOST group
-- (observed: "nortia uno" with 7 parcels, "Ferma Dunărea" with 1).
--
-- Mirror of the rename-propagation trigger in 00065. Nulling a parcel's farm_id
-- fires the existing BEFORE trigger trg_parcels_set_farm_name (00065) which nulls
-- farm_name, and set_sync_version (00040) which bumps sync_version so phones
-- re-pull the cleared name on the next delta — so this touches only farm_id and
-- lets those triggers cascade the derived columns. Idempotent throughout.

-- 1. Detach-on-delete trigger ---------------------------------------------
--    AFTER UPDATE OF deleted_at, only on the NULL -> NOT NULL edge (the delete).
--    A later restore (NOT NULL -> NULL) does NOT re-attach — correct, since the
--    parcels are already unassigned and may have been re-homed meanwhile.
--    SECURITY DEFINER: defense-in-depth for the direct PostgREST path (the NestJS
--    backend already writes as table owner), matching farms_propagate_name (00065).
CREATE OR REPLACE FUNCTION farms_detach_parcels_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE parcels
     SET farm_id = NULL
   WHERE farm_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_farms_detach_parcels ON farms;
CREATE TRIGGER trg_farms_detach_parcels
  AFTER UPDATE OF deleted_at ON farms
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION farms_detach_parcels_on_delete();

-- 2. One-time backfill: detach parcels already orphaned by a PAST farm delete
--    (farm soft-deleted OR row gone). `NOT IN (live farm ids)` covers both cases;
--    farms.id is a non-null PK so NOT IN is NULL-safe. Their farm_id/farm_name
--    were never cleared before this migration. Re-running finds nothing.
UPDATE parcels
   SET farm_id = NULL
 WHERE farm_id IS NOT NULL
   AND farm_id NOT IN (SELECT id FROM farms WHERE deleted_at IS NULL);

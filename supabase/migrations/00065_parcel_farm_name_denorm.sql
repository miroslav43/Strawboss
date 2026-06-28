-- 00065_parcel_farm_name_denorm.sql
-- Denormalize the owning farm's NAME onto each parcel as `farm_name`, so the
-- mobile "Teren activ" card can show which FARM a field belongs to — OFFLINE.
--
-- Why a stored column (not a JOIN): the mobile delta-sync pulls plain parcel
-- columns (see PULL_COLUMNS in sync.service.ts) and farms are NOT synced to the
-- device — parcels carried only `farm_id`. A trigger-maintained real column
-- flows for free through the sync pull AND the /api/v1/parcels SELECT, and a
-- farm RENAME re-stamps each affected parcel's sync_version (via set_sync_version,
-- 00040) so phones re-pull the new name on the next delta. A read-time JOIN would
-- leave devices with a stale farm name forever (parcel sync_version wouldn't bump).
--
-- Idempotent throughout.

-- 1. Column ---------------------------------------------------------------
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS farm_name TEXT;

-- 2. Backfill from the current farm name ----------------------------------
UPDATE parcels p
   SET farm_name = f.name
  FROM farms f
 WHERE f.id = p.farm_id
   AND p.farm_name IS DISTINCT FROM f.name;

-- 3. Keep farm_name current when a parcel's farm_id is (re)assigned --------
--    BEFORE trigger so the derived value lands in the same row write. Fires on
--    INSERT (always) and on UPDATE only when farm_id is in the SET list. Runs
--    alongside trg_parcels_sync_version (independent column) on the same write.
CREATE OR REPLACE FUNCTION parcels_set_farm_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.farm_id IS NULL THEN
    NEW.farm_name := NULL;
  ELSE
    SELECT f.name INTO NEW.farm_name FROM farms f WHERE f.id = NEW.farm_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parcels_set_farm_name ON parcels;
CREATE TRIGGER trg_parcels_set_farm_name
  BEFORE INSERT OR UPDATE OF farm_id ON parcels
  FOR EACH ROW EXECUTE FUNCTION parcels_set_farm_name();

-- 4. Propagate a farm RENAME to all its parcels ---------------------------
--    The UPDATE on parcels fires set_sync_version (BEFORE UPDATE) → each affected
--    parcel gets a fresh sync_version → mobile delta-pull re-fetches the new name.
--    This UPDATE touches only farm_name (not farm_id), so trg_parcels_set_farm_name
--    does NOT re-fire — no recursion. SECURITY DEFINER (defense-in-depth for the
--    direct PostgREST path; the NestJS backend already writes as table owner).
CREATE OR REPLACE FUNCTION farms_propagate_name_to_parcels()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE parcels
     SET farm_name = NEW.name
   WHERE farm_id = NEW.id
     AND farm_name IS DISTINCT FROM NEW.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_farms_propagate_name ON farms;
CREATE TRIGGER trg_farms_propagate_name
  AFTER UPDATE OF name ON farms
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION farms_propagate_name_to_parcels();

-- ============================================================================
-- 00042_parcel_crop_and_harvest_extended.sql
--
-- Plan B (T9.1, T9.10, T6, T7, T9.2 partial)
--
-- T9.1  : add crop_type enum + parcels.crop_type column.
-- T9.10 : extend harvest_status enum with partial_harvested, in_loading,
--         loaded, completed.
-- T6+T7 : add downgrade-prevention trigger so the harvest ladder is
--         monotonic. Allow emergency bypass via the local GUC
--         `app.allow_harvest_downgrade = 'on'`.
-- T9.2  : keep parcels.is_active column for one release but stop reading /
--         writing from API. No DDL drop here.
--
-- Idempotent: safe to re-run. ALTER TYPE ADD VALUE is non-transactional in
-- Postgres < 12; Supabase ships 15+, so IF NOT EXISTS is enough.
-- ============================================================================

-- ── 1. crop_type enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE crop_type AS ENUM ('grau', 'orz', 'rapita', 'plante_nutret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. parcels.crop_type column (nullable, no default) ───────────────────────
--   Nullable so that admins are forced to set it explicitly per parcel;
--   missing-data dashboards can list parcels WHERE crop_type IS NULL.
DO $$ BEGIN
  ALTER TABLE parcels ADD COLUMN crop_type crop_type;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 3. harvest_status enum extensions ────────────────────────────────────────
--   ADD VALUE IF NOT EXISTS is supported since Postgres 9.6.
--   New values are appended at the end of pg_enum.oid order. Any UI / SQL
--   that needs the *logical* ladder must use harvest_status_rank() below,
--   never ORDER BY harvest_status directly.
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'partial_harvested';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'in_loading';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'loaded';
ALTER TYPE harvest_status ADD VALUE IF NOT EXISTS 'completed';

-- ── 4. Ladder helper function ────────────────────────────────────────────────
--   Maps each harvest_status to an integer rank for monotonic comparison.
--   T7: 'harvested' (4) > 'partial_harvested' (3) so partial -> harvested OK,
--       but harvested -> partial_harvested is blocked by the trigger below.
CREATE OR REPLACE FUNCTION harvest_status_rank(s harvest_status)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE s::text
    WHEN 'planned'           THEN 0
    WHEN 'to_harvest'        THEN 1
    WHEN 'harvesting'        THEN 2
    WHEN 'partial_harvested' THEN 3
    WHEN 'harvested'         THEN 4
    WHEN 'in_loading'        THEN 5
    WHEN 'loaded'            THEN 6
    WHEN 'completed'         THEN 7
  END
$$;

-- ── 5. Downgrade-prevention trigger ──────────────────────────────────────────
--   Raises a check_violation if a row's harvest_status would move backward
--   on the ladder. Allows equal -> equal (no-op updates) and any forward jump.
--   Admins with a privileged session can bypass by setting
--     SET LOCAL app.allow_harvest_downgrade = 'on';
--   before issuing the fix UPDATE (used by data-fix scripts only).
CREATE OR REPLACE FUNCTION prevent_harvest_status_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_bypass TEXT;
BEGIN
  IF NEW.harvest_status IS NULL OR OLD.harvest_status IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.harvest_status = OLD.harvest_status THEN
    RETURN NEW;
  END IF;

  -- Optional bypass for emergency data fixes
  v_bypass := current_setting('app.allow_harvest_downgrade', true);
  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  IF harvest_status_rank(NEW.harvest_status) < harvest_status_rank(OLD.harvest_status) THEN
    RAISE EXCEPTION
      'harvest_status downgrade blocked: % (rank %) -> % (rank %) on parcel %',
      OLD.harvest_status, harvest_status_rank(OLD.harvest_status),
      NEW.harvest_status, harvest_status_rank(NEW.harvest_status),
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_harvest_status_downgrade ON parcels;
CREATE TRIGGER trg_prevent_harvest_status_downgrade
  BEFORE UPDATE OF harvest_status ON parcels
  FOR EACH ROW
  EXECUTE FUNCTION prevent_harvest_status_downgrade();

-- ── 6. Indexes ───────────────────────────────────────────────────────────────
--   Partial index on crop_type for "filter by crop" admin queries.
CREATE INDEX IF NOT EXISTS idx_parcels_crop_type
  ON parcels (crop_type)
  WHERE deleted_at IS NULL AND crop_type IS NOT NULL;

--   Partial index on harvest_status for map / dashboard lookups.
CREATE INDEX IF NOT EXISTS idx_parcels_harvest_status
  ON parcels (harvest_status)
  WHERE deleted_at IS NULL;

-- ── 7. sync_version bump on harvest_status / crop_type updates ───────────────
--   00040_global_sync_version.sql already bumps sync_version on UPDATE for
--   parcels, so column-touching here is enough to surface deltas to clients.

-- ── 8. RLS verification ──────────────────────────────────────────────────────
--   RLS on parcels was provisioned in 00008_rls_policies.sql.
--   No policy change needed — new column inherits row-level scope.

-- ── 9. Backfill (no-op) ──────────────────────────────────────────────────────
--   crop_type left NULL on existing rows; admin will fill in via UI.
--   Existing rows with harvest_status = 'harvested' remain valid; the
--   downgrade trigger now protects them.

-- ── 10. Comment metadata ────────────────────────────────────────────────────
COMMENT ON COLUMN parcels.crop_type IS 'T9.1 — wheat/barley/rapeseed/forage. NULL = not yet set.';
COMMENT ON TYPE  harvest_status   IS 'T9.10 — extended ladder enforced by trg_prevent_harvest_status_downgrade.';

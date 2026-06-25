-- 00055_parcel_bale_overrides.sql
-- Admin manual override of a parcel's bale tallies + direct field → depot transfer.
--
-- A parcel's "produced" / "loaded" bale counts are COMPUTED aggregates
-- (SUM over bale_productions / bale_loads), NOT stored columns, and bale_count
-- carries a CHECK (> 0). So an admin "override" — which may LOWER a count below
-- what operators recorded — cannot be a plain insert. This migration adds a
-- signed-delta adjustments ledger that ParcelsService.getBaleAvailability folds
-- into the totals (produced/loaded += SUM(delta) of the matching kind).
--
-- The "transfer to depot" action needs NO new schema: it reuses the existing
-- auxiliary-truck mechanism (00054) — a per-org virtual machine (is_auxiliary)
-- plus a trip collapsed straight to `completed` with destination_coords = the
-- depot's coords, so deposit-inventory's 50 m spatial join counts it as stock.
--
-- Idempotent throughout.

-- ============================================================
-- parcel_bale_adjustments — signed manual corrections to a parcel's tallies.
--   kind  : which aggregate this corrects ('produced' | 'loaded')
--   delta : signed integer (may be NEGATIVE) added to the computed total
-- Org-scoped, soft-delete, sync_version-stamped (reuses set_sync_version, 00040).
-- ============================================================
CREATE TABLE IF NOT EXISTS parcel_bale_adjustments (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID         NOT NULL REFERENCES organizations(id),
  parcel_id        UUID         NOT NULL REFERENCES parcels(id),
  kind             TEXT         NOT NULL CHECK (kind IN ('produced', 'loaded')),
  delta            INTEGER      NOT NULL,
  reason           TEXT,
  created_by       UUID         REFERENCES users(id),
  sync_version     BIGINT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_parcel_bale_adjustments_parcel
  ON parcel_bale_adjustments (parcel_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parcel_bale_adjustments_org
  ON parcel_bale_adjustments (organization_id)
  WHERE deleted_at IS NULL;

-- sync_version stamp (reuses the global sequence + function created in 00040).
DROP TRIGGER IF EXISTS trg_parcel_bale_adjustments_sync_version ON parcel_bale_adjustments;
CREATE TRIGGER trg_parcel_bale_adjustments_sync_version
  BEFORE INSERT OR UPDATE ON parcel_bale_adjustments
  FOR EACH ROW EXECUTE FUNCTION set_sync_version();

CREATE INDEX IF NOT EXISTS idx_parcel_bale_adjustments_sync_version
  ON parcel_bale_adjustments (sync_version);

-- ============================================================
-- RLS — admin only, org-scoped. Defense-in-depth ONLY: the NestJS backend
-- connects as the table owner via DATABASE_URL and BYPASSES RLS (it is the sole
-- writer). These policies matter only for a direct PostgREST / Realtime path
-- carrying an admin JWT.
--
-- ::text cast on user_role() is REQUIRED (stale user_role_old enum — see 00052).
-- ============================================================
ALTER TABLE parcel_bale_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_parcel_bale_adjustments ON parcel_bale_adjustments;
CREATE POLICY admin_all_parcel_bale_adjustments ON parcel_bale_adjustments FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

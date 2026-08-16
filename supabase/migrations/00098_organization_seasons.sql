-- 00098_organization_seasons.sql
-- Seasons per organization: close a calendar year, carry the physical stock
-- forward, and let every statistic restart from zero.
--
-- Why: nothing in this schema has ever had a notion of a campaign. Every number
-- a farmer actually looks at is a lifetime accumulator -- depot stock, bales
-- produced/loaded on a field, and worst of all getBaleAvailability(), the gate
-- that decides whether a loader is allowed to load at all. At the second season
-- the dashboard stops meaning anything and last year's bales stay "available"
-- on a field forever.
--
-- ── THE SEASON IS DERIVED, NOT STAMPED ──────────────────────────────────────
--
-- There is deliberately NO season_id on trips/bale_loads/fuel_logs/... . A
-- season is a strict calendar year in Europe/Bucharest, so a row's season is a
-- pure function of its own business date (trips.created_at,
-- bale_productions.production_date, bale_loads.loaded_at, fuel_logs.logged_at,
-- task_assignments.assignment_date, ...). Four consequences, all load-bearing:
--
--   * A LATE OFFLINE PUSH LANDS IN THE RIGHT SEASON. A phone that syncs a bale
--     load on 3 January carrying loaded_at = 30 December files it under the
--     season it belongs to. Stamping "the active season" at write time would
--     have filed it under the wrong year.
--   * No backfill, and no state that can drift away from the date.
--   * RLS is untouched. A real season_id would need a new predicate on USING
--     *and* WITH CHECK for ~50 policies, or a user could write into another
--     season.
--   * No mass UPDATE, so no sync storm. Backfilling a stamped column would
--     touch every row of every tenant, and the BEFORE-UPDATE trigger from 00040
--     would re-stamp each one from the GLOBAL sync_version_seq. Pulls are
--     org-filtered, so this is not a cross-tenant leak -- but every phone in
--     every organization would still re-pull its own history, 1000 rows per
--     table per cycle. (Merely CONSUMING sequence values is free; it is the
--     UPDATE that costs.)
--
-- These tables therefore hold only what CANNOT be derived from a date: which
-- seasons exist and are closed, what physically carried over, and what the
-- per-parcel seasonal state was at the moment of closing.
--
-- ── CLOSING IS MANUAL, AND THAT IS THE POINT ────────────────────────────────
--
-- The year rolls over by itself at midnight on 1 January -- new rows simply
-- carry a new year. The admin presses "close season <year>" later, once field
-- work has demonstrably synced. Closing at midnight would reject a late push
-- from an offline phone; a rejected non-terminal push enters quadratic backoff
-- (mobile sync-queue-repo) and is silently destroyed after 7 days along with
-- the operator's work.
--
-- ── IDEMPOTENCY (MANDATORY) ─────────────────────────────────────────────────
-- scripts db:migrate re-runs EVERY file on EVERY invocation (no migration
-- tracking table), each in its own `psql --single-transaction`. So:
--   * every statement here is IF NOT EXISTS / DROP-then-ADD;
--   * there is deliberately NO down-migration -- a DROP would re-drop on every
--     subsequent deploy;
--   * `SET lock_timeout` is transaction-scoped by --single-transaction.
--
-- The runner prints FAIL and CONTINUES, exiting 0 either way. Confirm by hand:
--   psql "$DATABASE_URL" -c "\d organization_seasons"
--   psql "$DATABASE_URL" -c "\d organizations" | grep active_season_year

-- AuthGuard joins organizations on every cache miss; a queued ACCESS EXCLUSIVE
-- there stalls the whole API. Adding a nullable column is metadata-only on
-- PG11+, so 3s is generous.
SET lock_timeout = '3s';

-- ============================================================
-- 1. organizations.active_season_year  (read cache only)
-- ============================================================
-- The authoritative record of which seasons exist and which are closed is
-- organization_seasons. This column exists so the hot read path -- resolving
-- "which season am I looking at by default" on every request -- does not need a
-- second query. NULL means "never closed a season", which resolves to the
-- current calendar year.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS active_season_year INT;

COMMENT ON COLUMN organizations.active_season_year IS
  'Read cache for the org''s current season (calendar year). Authoritative '
  'state lives in organization_seasons. NULL = never closed a season = use the '
  'current calendar year in Europe/Bucharest.';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_active_season_year_sane;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_active_season_year_sane
  CHECK (active_season_year IS NULL
         OR (active_season_year >= 2020 AND active_season_year <= 2200));

-- ============================================================
-- 2. organization_seasons  -- which seasons exist, and which are locked
-- ============================================================
-- One row per (org, year). A row is created lazily the first time a season is
-- referenced or closed; the ABSENCE of a row means "open", so no backfill is
-- needed for the years already in the database.
CREATE TABLE IF NOT EXISTS organization_seasons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id),
  year            INT         NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'open',
  closed_at       TIMESTAMPTZ,
  -- Nullable: history stays readable if the acting account is later removed.
  closed_by       UUID        REFERENCES users(id),
  -- Mandatory at close time in application code (mirrors the feature-toggle
  -- audit in 00093); nullable here so an 'open' row needs no note.
  closing_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organization_seasons
  DROP CONSTRAINT IF EXISTS organization_seasons_status_valid;
ALTER TABLE organization_seasons
  ADD CONSTRAINT organization_seasons_status_valid
  CHECK (status IN ('open', 'closed'));

ALTER TABLE organization_seasons
  DROP CONSTRAINT IF EXISTS organization_seasons_year_sane;
ALTER TABLE organization_seasons
  ADD CONSTRAINT organization_seasons_year_sane
  CHECK (year >= 2020 AND year <= 2200);

-- A closed season must record when it was closed: the closing timestamp is what
-- makes "this number was frozen on that date" defensible.
ALTER TABLE organization_seasons
  DROP CONSTRAINT IF EXISTS organization_seasons_closed_has_timestamp;
ALTER TABLE organization_seasons
  ADD CONSTRAINT organization_seasons_closed_has_timestamp
  CHECK (status <> 'closed' OR closed_at IS NOT NULL);

-- The uniqueness that makes "is season Y closed for org X" a single lookup, and
-- makes double-closing impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_seasons_org_year
  ON organization_seasons (organization_id, year);

DROP TRIGGER IF EXISTS trg_organization_seasons_updated_at ON organization_seasons;
CREATE TRIGGER trg_organization_seasons_updated_at
  BEFORE UPDATE ON organization_seasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. season_opening_balances  -- what physically carried over
-- ============================================================
-- The accounting split, applied to straw: balance-sheet quantities carry into
-- the new year, result quantities reset. Bales sitting in a depot on 31
-- December are still there on 1 January, so the new season starts with an
-- opening balance rather than zero.
--
-- Stock for season Y is therefore  opening_balance(Y) + movements(Y).
-- While no opening row exists for Y (because Y-1 has not been closed yet),
-- readers fall back to the all-time cumulative -- i.e. exactly today's
-- behaviour. Nobody sees a false zero in January.
--
-- depot_id XOR parcel_id: the product decision today is that FIELDS start from
-- zero and only DEPOTS carry over, so only depot rows are written. The parcel
-- arm exists because the alternative is a second table later, and because
-- carrying a field balance is a one-line change if that decision is revisited.
CREATE TABLE IF NOT EXISTS season_opening_balances (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id),
  -- The season this balance OPENS (i.e. closed_year + 1).
  season_year        INT         NOT NULL,
  depot_id           UUID,
  parcel_id          UUID,
  bale_count         INT         NOT NULL DEFAULT 0,
  net_weight_kg      NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- The season the balance was carried FROM, for traceability.
  source_season_year INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID        REFERENCES users(id)
);

ALTER TABLE season_opening_balances
  DROP CONSTRAINT IF EXISTS season_opening_balances_target_xor;
ALTER TABLE season_opening_balances
  ADD CONSTRAINT season_opening_balances_target_xor
  CHECK ((depot_id IS NOT NULL AND parcel_id IS NULL)
      OR (depot_id IS NULL AND parcel_id IS NOT NULL));

-- Negative stock is a bug, not a state. The three depot-stock readers already
-- clamp with GREATEST(..., 0), which silently hides an inconsistency; rejecting
-- it here means the closing transaction fails loudly instead.
ALTER TABLE season_opening_balances
  DROP CONSTRAINT IF EXISTS season_opening_balances_non_negative;
ALTER TABLE season_opening_balances
  ADD CONSTRAINT season_opening_balances_non_negative
  CHECK (bale_count >= 0 AND net_weight_kg >= 0);

ALTER TABLE season_opening_balances
  DROP CONSTRAINT IF EXISTS season_opening_balances_year_sane;
ALTER TABLE season_opening_balances
  ADD CONSTRAINT season_opening_balances_year_sane
  CHECK (season_year >= 2020 AND season_year <= 2200);

-- Cross-org composite FKs, the repo-wide hardening pattern (00063/00068/00070/
-- 00091): the org id travels with the reference, so a balance can never point
-- at another tenant's depot or field even if application code forgets to check.
-- MATCH SIMPLE means a NULL arm is simply not checked, which is what makes the
-- XOR above work.
ALTER TABLE season_opening_balances
  DROP CONSTRAINT IF EXISTS season_opening_balances_depot_org_fkey;
ALTER TABLE season_opening_balances
  ADD CONSTRAINT season_opening_balances_depot_org_fkey
  FOREIGN KEY (organization_id, depot_id)
  REFERENCES delivery_destinations (organization_id, id);

ALTER TABLE season_opening_balances
  DROP CONSTRAINT IF EXISTS season_opening_balances_parcel_org_fkey;
ALTER TABLE season_opening_balances
  ADD CONSTRAINT season_opening_balances_parcel_org_fkey
  FOREIGN KEY (organization_id, parcel_id)
  REFERENCES parcels (organization_id, id);

-- One opening balance per target per season. Partial, because the XOR leaves
-- the other column NULL and NULLs do not collide in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_season_opening_balances_depot
  ON season_opening_balances (organization_id, season_year, depot_id)
  WHERE depot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_season_opening_balances_parcel
  ON season_opening_balances (organization_id, season_year, parcel_id)
  WHERE parcel_id IS NOT NULL;

-- The read every stock query performs: "opening balances for this org+season".
CREATE INDEX IF NOT EXISTS idx_season_opening_balances_org_season
  ON season_opening_balances (organization_id, season_year);

-- ============================================================
-- 4. parcel_season_snapshots  -- snapshot then reset
-- ============================================================
-- harvest_status and crop_type live on `parcels`, which is master data that
-- survives the rollover -- but both are SEASONAL facts (a field is re-harvested
-- every year, and crops rotate). Closing therefore snapshots them here and then
-- resets the live column, so every existing reader keeps working unchanged
-- while the per-season history is still queryable.
--
-- The final tallies are stored too. They are derivable from the transactional
-- tables, but only as long as those rows are never touched; a snapshot makes a
-- closed season's numbers genuinely frozen, which is the point of closing.
CREATE TABLE IF NOT EXISTS parcel_season_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id),
  season_year     INT         NOT NULL,
  parcel_id       UUID        NOT NULL,
  harvest_status  harvest_status,
  crop_type       crop_type,
  bales_produced  INT         NOT NULL DEFAULT 0,
  bales_loaded    INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE parcel_season_snapshots
  DROP CONSTRAINT IF EXISTS parcel_season_snapshots_year_sane;
ALTER TABLE parcel_season_snapshots
  ADD CONSTRAINT parcel_season_snapshots_year_sane
  CHECK (season_year >= 2020 AND season_year <= 2200);

ALTER TABLE parcel_season_snapshots
  DROP CONSTRAINT IF EXISTS parcel_season_snapshots_parcel_org_fkey;
ALTER TABLE parcel_season_snapshots
  ADD CONSTRAINT parcel_season_snapshots_parcel_org_fkey
  FOREIGN KEY (organization_id, parcel_id)
  REFERENCES parcels (organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parcel_season_snapshots
  ON parcel_season_snapshots (organization_id, season_year, parcel_id);

-- ============================================================
-- 5. RLS posture
-- ============================================================
-- Server-authoritative, same model as machine_last_positions (00081),
-- outbound_messages (00071), geocode_cache (00089) and
-- organization_feature_changes (00093): RLS ON with NO permissive policy. The
-- NestJS backend is the table owner and bypasses RLS; nothing reads these over
-- PostgREST, and admin-web gets them through the API like everything else.
--
-- This also sidesteps public.user_role(), which still resolves to the stale
-- user_role_old enum (00079) and would need a ::text cast in any policy naming
-- a role.
--
-- None of these tables are added to the supabase_realtime publication: a season
-- closes once a year, so there is nothing to push live.
ALTER TABLE organization_seasons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_opening_balances  ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_season_snapshots  ENABLE ROW LEVEL SECURITY;

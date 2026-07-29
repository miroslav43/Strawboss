-- 00093_org_feature_overrides.sql
-- Per-organization feature toggles.
--
-- Why: one installation serves several organizations, but every one of them
-- gets the identical product today — all 17 web sections, all 8 account types,
-- every mobile tab. There is no way to say "this farm has no baler" or "this
-- customer did not buy the advanced reports", and no way to switch a
-- misbehaving feature off for one tenant without a redeploy.
--
-- A super_admin flips modules/features per org; the backend then blocks the
-- corresponding WRITE paths while every READ path (history, reports, documents)
-- stays open. A disabled feature must never make existing data unreachable or
-- make an aggregate lie.
--
-- ── STORAGE MODEL: SPARSE OVERRIDES, NOT A FULL MAP ─────────────────────────
--
-- feature_overrides holds ONLY deviations from the static registry in
-- packages/types/src/features.ts, e.g. {"costs.fuel": false}.
--   effective = override ?? registry default
--
-- Two consequences, both deliberate:
--   * A feature added to the registry six months from now needs NO backfill —
--     every existing org picks up its default automatically.
--   * Every registry default is `true` (typed as the literal, so `false` cannot
--     compile), therefore an untouched org stores '{}' and resolves to zero
--     disabled features. THIS MIGRATION CANNOT CHANGE BEHAVIOUR FOR ANY
--     EXISTING ORGANIZATION ON ITS OWN. Verify after applying:
--       SELECT count(*) FROM organizations WHERE feature_overrides <> '{}'::jsonb;  -- expect 0
--
-- plan_label is COSMETIC ONLY — it records which preset button was last pressed
-- so the super-admin org list can show "Basic". No code branches on it; there is
-- no plans table and no plan_id.
--
-- ── NO INDEX ON feature_overrides ───────────────────────────────────────────
-- The column is read only by organizations.id (already the PK), once per
-- AuthGuard cache miss, inside the users LEFT JOIN organizations lookup that
-- already runs on every authenticated request. A GIN index here would be pure
-- write cost with no reader.
--
-- ── IDEMPOTENCY (MANDATORY) ─────────────────────────────────────────────────
-- scripts db:migrate re-runs EVERY file on EVERY invocation (no migration
-- tracking table), each in its own `psql --single-transaction`. So:
--   * every statement here is IF NOT EXISTS / DROP-then-ADD;
--   * there is deliberately NO down-migration — a DROP COLUMN would drop the
--     column again on every subsequent deploy;
--   * `SET lock_timeout` is transaction-scoped by --single-transaction and does
--     not leak into later migration files.
--
-- Note the runner prints FAIL and CONTINUES, exiting 0 either way. Always
-- confirm by hand:  psql "$DATABASE_URL" -c "\d organizations" | grep feature_overrides

-- A queued ACCESS EXCLUSIVE on organizations would stall every API request,
-- because AuthGuard joins this table on each cache miss. Adding a column with a
-- constant default is metadata-only on PG11+, so 3s is generous.
SET lock_timeout = '3s';

-- ============================================================
-- 1. organizations.feature_overrides
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS feature_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN organizations.feature_overrides IS
  'Sparse per-org feature toggles: ONLY deviations from the registry defaults in '
  '@strawboss/types features.ts. Shape {"<module>.<leaf>": boolean}. '
  '{} = pure registry defaults = everything on. Never stores the full map.';

-- A scalar or array here would make the resolver read `undefined` for every key
-- and silently resolve the org to "everything on" — or worse, crash the
-- AuthGuard path on every request from that tenant. Rejecting it at the
-- database is far cheaper than diagnosing it in production.
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_feature_overrides_is_object;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_feature_overrides_is_object
  CHECK (jsonb_typeof(feature_overrides) = 'object');

-- ============================================================
-- 2. organizations.plan_label  (display only)
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_label TEXT;

COMMENT ON COLUMN organizations.plan_label IS
  'Cosmetic commercial-plan name for the super-admin org list ("Basic"/"Pro"/'
  '"Enterprise"). Display only - the authoritative state is feature_overrides.';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_label_len;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_label_len
  CHECK (plan_label IS NULL OR char_length(plan_label) <= 64);

-- Existing RLS on organizations (org_read_own, 00052) covers the new columns
-- automatically. That is acceptable: a member of an org may read its own flags,
-- and both clients are told them anyway. No INSERT/UPDATE policy is added --
-- there is none today, so direct PostgREST writes stay fail-closed, and the
-- NestJS backend connects as table owner and bypasses RLS entirely.
-- organizations is deliberately NOT added to the supabase_realtime publication.

-- ============================================================
-- 3. organization_feature_changes  -- audit trail for the toggles themselves
--    `organizations` is NOT in the 11-table audit trigger list (00023) and
--    audit.interceptor.ts is declared but never bound to anything, so without
--    this table a cross-tenant kill-switch would leave no trace at all.
--    One row per changed KEY (not per save) so "when did X get switched off,
--    by whom, and why" is a single indexed lookup.
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_feature_changes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id),
  feature_key     TEXT        NOT NULL,
  -- NULL = the key had no override before (was running on the registry default).
  old_enabled     BOOLEAN,
  new_enabled     BOOLEAN     NOT NULL,
  -- Nullable: keeps history readable if the acting account is later hard-removed.
  actor_user_id   UUID        REFERENCES users(id),
  actor_role      TEXT,
  reason          TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves both reads we actually do: the per-org history panel, and "what
-- changed recently" ordered newest-first.
CREATE INDEX IF NOT EXISTS idx_org_feature_changes_org_created
  ON organization_feature_changes (organization_id, created_at DESC);

-- Append-only by convention (the product sells immutable audit): no UPDATE or
-- DELETE path exists in application code.
--
-- RLS on with NO permissive policy -- the same server-authoritative model as
-- machine_last_positions (00081), outbound_messages (00071) and geocode_cache
-- (00089). The backend is table owner and bypasses RLS; nothing reads this over
-- PostgREST. This also sidesteps public.user_role() entirely, which still
-- returns the stale user_role_old enum (see 00079) and would need a ::text cast
-- in any policy that named a role.
ALTER TABLE organization_feature_changes ENABLE ROW LEVEL SECURITY;

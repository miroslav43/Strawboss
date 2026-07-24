-- 00087_transportator_role_and_assignments.sql
--
-- Introduces the WEB-only `transportator` (external hauler) account type and the
-- machinery it needs:
--   1. the `transportator` enum label (on both user_role AND the stale user_role_old,
--      per 00079, so RLS can evaluate for a transportator session);
--   2. `transporter_beneficiaries` — the many-to-many link an admin manages to say
--      which beneficiaries a transporter may act for (set-replace / hard delete);
--   3. `trip_requests.created_by_user_id` — provenance stamped by the authenticated
--      transporter form, backing the transporter's read-only "my trips" ledger.
--
-- The NestJS backend connects as table owner and BYPASSES RLS; the policies below
-- are defense-in-depth for any direct PostgREST/Realtime access with a user JWT.
-- Nothing here is synced to mobile (transportator is a web-only role).
--
-- `ALTER TYPE ... ADD VALUE` cannot have its new value USED in the same transaction
-- it is added in. This migration only ADDS the label; it never casts the literal to
-- the enum (RLS compares `users.role::text` to a text constant, all new columns are
-- UUID), so it is safe under the runner's `psql --single-transaction` wrapper — same
-- reasoning as 00043 / 00079.

-- ── 1. Enum label ────────────────────────────────────────────────────────────
ALTER TYPE user_role     ADD VALUE IF NOT EXISTS 'transportator';
-- user_role_old is what public.user_role() actually returns (see 00079). Adding the
-- label here keeps that function from erroring ("invalid input value for enum
-- user_role_old") when a transportator session hits any pre-existing RLS policy.
ALTER TYPE user_role_old ADD VALUE IF NOT EXISTS 'transportator';

-- ── 2. users composite-unique target (an FK must reference a unique/PK key) ───
-- users only had a plain idx_users_org_id (00036). The junction below needs a
-- cross-org composite FK into users, matching the 00063 / 00068 hardening. id is
-- already the PK so (organization_id, id) is trivially unique — purely additive.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_org_id_key;
ALTER TABLE users ADD CONSTRAINT users_org_id_key UNIQUE (organization_id, id);

-- ── 3. transporter_beneficiaries (M:N, hard delete / set-replace) ────────────
CREATE TABLE IF NOT EXISTS transporter_beneficiaries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transporter_user_id UUID        NOT NULL,
  beneficiary_id      UUID        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transporter_beneficiaries_uniq UNIQUE (transporter_user_id, beneficiary_id),
  -- Cross-org guards: the user AND the beneficiary must belong to this row's org.
  CONSTRAINT transporter_beneficiaries_user_org_fkey
    FOREIGN KEY (organization_id, transporter_user_id)
    REFERENCES users (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT transporter_beneficiaries_ben_org_fkey
    FOREIGN KEY (organization_id, beneficiary_id)
    REFERENCES beneficiaries (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transporter_beneficiaries_user
  ON transporter_beneficiaries(transporter_user_id);
CREATE INDEX IF NOT EXISTS idx_transporter_beneficiaries_ben
  ON transporter_beneficiaries(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_transporter_beneficiaries_org
  ON transporter_beneficiaries(organization_id);

-- ── 4. trip_requests.created_by_user_id (provenance, nullable) ────────────────
-- NULL for the public portals (4-digit code + beneficiary PIN). Simple FK to
-- users(id) — this is provenance, not an org guard, and avoids depending on the
-- new users_org_id_key.
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id);

-- Backs the transporter ledger query (WHERE created_by_user_id = <me>).
CREATE INDEX IF NOT EXISTS idx_trip_requests_created_by
  ON trip_requests (organization_id, created_by_user_id)
  WHERE deleted_at IS NULL AND created_by_user_id IS NOT NULL;

-- ── 5. RLS (defense-in-depth) ────────────────────────────────────────────────
-- Uses the current convention (00068): read the caller's role/org directly from
-- `users` via auth.uid(), casting `role::text` — this sidesteps the stale
-- public.user_role()/user_role_old function entirely.

ALTER TABLE transporter_beneficiaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transporter_beneficiaries_admin_all ON transporter_beneficiaries;
CREATE POLICY transporter_beneficiaries_admin_all ON transporter_beneficiaries
  FOR ALL
  USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid) IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid) IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS transporter_beneficiaries_own_read ON transporter_beneficiaries;
CREATE POLICY transporter_beneficiaries_own_read ON transporter_beneficiaries
  FOR SELECT
  USING (
    (SELECT role::text FROM users WHERE id = auth.uid()::uuid) = 'transportator'
    AND transporter_user_id = auth.uid()::uuid
  );

-- trip_requests already has RLS enabled (00054); this SELECT policy is additive
-- (policies are OR'd) and lets a transporter read ONLY the requests they created.
DROP POLICY IF EXISTS trip_requests_transporter_read ON trip_requests;
CREATE POLICY trip_requests_transporter_read ON trip_requests
  FOR SELECT
  USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid) = 'transportator'
    AND created_by_user_id = auth.uid()::uuid
  );

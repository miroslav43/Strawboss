-- 00045_user_sessions_rls_hardening.sql
-- Plan A T4 — defense-in-depth hardening on top of 00044:
--   (1) Tighten own_sessions_read to also require the row's organization_id
--       to match the caller's user.organization_id. Closes a theoretical
--       cross-org read if user_id ever resolves to a multi-org account.
--   (2) Split admin_sessions_read into two policies: admin/dispatcher (strictly
--       org-scoped) and super_admin (unscoped). Makes the privilege boundary
--       explicit and easier to audit/disable independently.
--   (3) Add UNIQUE(user_id, started_at) constraint so concurrent heartbeats
--       at the 2-minute gap boundary cannot create duplicate overlapping
--       sessions. ProfileService.touchLastSeen now does ON CONFLICT DO NOTHING.
--
-- Idempotent: every DDL is guarded with IF NOT EXISTS / DROP IF EXISTS.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) UNIQUE constraint on (user_id, started_at) — race-free heartbeat insert.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_sessions_user_started_unique'
  ) THEN
    ALTER TABLE user_sessions
      ADD CONSTRAINT user_sessions_user_started_unique
      UNIQUE (user_id, started_at);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Drop the old policies from 00044 and recreate hardened ones.
-- ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS own_sessions_read ON user_sessions;
DROP POLICY IF EXISTS admin_sessions_read ON user_sessions;
DROP POLICY IF EXISTS admin_org_sessions_read ON user_sessions;
DROP POLICY IF EXISTS super_admin_sessions_read ON user_sessions;

-- A user sees only their own sessions inside their own organization.
CREATE POLICY own_sessions_read ON user_sessions
  FOR SELECT
  USING (
    user_id = public.user_id()
    AND organization_id = (
      SELECT organization_id FROM users WHERE id = public.user_id()
    )
  );

-- Admin: strictly org-scoped reads.
-- NOTE: 'dispatcher' was removed from user_role in migration 00009 (renamed to
-- 'driver'). Referencing it here makes the whole migration abort with
-- "invalid input value for enum user_role: dispatcher", which is why the
-- UNIQUE(user_id, started_at) constraint above never landed in production and
-- POST /profile/heartbeat 500'd on every ping. Use 'admin' only.
CREATE POLICY admin_org_sessions_read ON user_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = public.user_id()
         AND u.role = 'admin'
         AND u.organization_id = user_sessions.organization_id
    )
  );

-- Super-admin: unscoped reads.
CREATE POLICY super_admin_sessions_read ON user_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = public.user_id()
         AND u.role = 'super_admin'
    )
  );

-- No INSERT/UPDATE/DELETE policies — service role writes only (touchLastSeen).

COMMIT;

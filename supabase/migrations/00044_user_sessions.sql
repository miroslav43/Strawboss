-- 00044_user_sessions.sql
-- Plan A T4 — Per-user session history for the "connected hours" admin report.
-- Sessions are derived from the existing /profile/heartbeat ping (mobile, ~30s):
--   * gap to last ended_at ≤ 2 min → extend current session (UPDATE ended_at)
--   * gap > 2 min                  → open a new session (INSERT)
-- The 90 s "online now" threshold (users.last_seen_at) stays unchanged.
--
-- Idempotent: every DDL is guarded with IF NOT EXISTS / DO $$ EXCEPTION blocks.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1) Table
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_sessions_ended_after_started
    CHECK (ended_at >= started_at)
);

COMMENT ON TABLE user_sessions IS
  'Per-user connected sessions derived from /profile/heartbeat. A session = '
  'continuous heartbeats with gaps ≤ 2 min. Used by the connected-hours admin report.';
COMMENT ON COLUMN user_sessions.started_at IS 'NOW() at the first heartbeat of the session.';
COMMENT ON COLUMN user_sessions.ended_at   IS 'NOW() at the most recent heartbeat that extended this session.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Indexes
-- ──────────────────────────────────────────────────────────────────────────
-- Hot path on every heartbeat: "give me the latest session for user X".
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_started
  ON user_sessions (user_id, started_at DESC);

-- Report aggregations group by organization and a date range on started_at/ended_at.
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_started
  ON user_sessions (organization_id, started_at);

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Row-level security
--    Strict service-role-only writes (the heartbeat endpoint uses the
--    service role). Reads: a user sees their own sessions; admin/dispatcher
--    see sessions inside their organization.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_sessions_read ON user_sessions;
CREATE POLICY own_sessions_read ON user_sessions
  FOR SELECT
  USING (user_id = public.user_id());

DROP POLICY IF EXISTS admin_sessions_read ON user_sessions;
-- NOTE: 'dispatcher' was removed from user_role in migration 00009 (renamed to
-- 'driver') — don't reference it here even if the TypeScript enum still has it.
CREATE POLICY admin_sessions_read ON user_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = public.user_id()
         AND u.role IN ('admin', 'super_admin')
         AND (u.organization_id = user_sessions.organization_id
              OR u.role = 'super_admin')
    )
  );

-- No INSERT/UPDATE/DELETE policies — only the service role (which bypasses RLS)
-- writes to this table from ProfileService.touchLastSeen.

COMMIT;

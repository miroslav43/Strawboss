-- 00056_fleet_tailscale.sql
-- Remote Tailscale control for the device fleet (super-admin) + a singleton app_settings
-- table for the editable Tailscale auth key.
--
-- The super-admin toggles `tailscale_desired` per device; the device (Device Owner) applies
-- it on next check-in by configuring the official Tailscale app via MDM (App Restrictions +
-- always-on VPN), joining the SAME tailnet as the VM so we can reach it over ADB-over-TCP.
-- The red/green dot fields (`tailscale_online`/`tailscale_ip`/`tailscale_last_seen`) are
-- written by a HOST-side `tailscale status` sync (the backend container can't reach the
-- tailnet). RLS is super-admin/service-role only (no permissive policy). Idempotent.

-- ============================================================
-- devices — Tailscale state columns.
-- ============================================================
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_desired   BOOLEAN NOT NULL DEFAULT false;
-- Last desired state the DEVICE confirmed it applied (via a successful command report). The
-- backend issues a tailscale command only while tailscale_applied <> tailscale_desired.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_applied   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_online    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_ip        TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_hostname  TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_last_seen TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_last_error TEXT;

-- ============================================================
-- app_settings — singleton global config the super-admin edits. The Tailscale auth key is a
-- SECRET: RLS denies all direct (PostgREST) access; only the backend service-role connection
-- reads/writes it, and it's only ever surfaced masked in the UI.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id                  BOOLEAN     PRIMARY KEY DEFAULT true,
  tailscale_auth_key  TEXT,
  tailscale_tailnet   TEXT        NOT NULL DEFAULT 'tail2b4c34.ts.net',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID        REFERENCES users(id),
  -- enforce a single row: id is always true
  CONSTRAINT app_settings_singleton CHECK (id = true)
);

-- Seed the one row (idempotent).
INSERT INTO app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- No permissive policy: service-role (backend) only.

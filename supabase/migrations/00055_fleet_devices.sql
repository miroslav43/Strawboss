-- 00055_fleet_devices.sql
-- Fleet management + OTA self-update.
--
-- Every install of the mobile app registers itself as a `devices` row on first launch
-- (PUBLIC check-in, before any user logs in, organization_id NULL until a super-admin
-- assigns it). A super-admin uploads an `app_releases` row (a signed APK), then creates
-- an `ota_deployments` row targeting some devices; each targeted device gets a
-- `device_ota_status` row tracking the per-device update state machine. Devices are
-- SERVER-AUTHORITATIVE (NOT mobile-synced, so no sync_version) — they pull work by
-- polling POST /api/v1/fleet/checkin.
--
-- RLS here is defense-in-depth ONLY. The NestJS backend connects as the table owner via
-- DATABASE_URL and BYPASSES RLS (it is the sole writer, including the public check-in).
-- Fleet management is super-admin-only and super_admin has organization_id = NULL, so it
-- never matches an org-scoped policy — it acts through the service-role connection.
-- The single permissive policy (admin read of own-org devices) exists for a future
-- direct PostgREST/Realtime path. ::text cast on user_role() is REQUIRED (stale
-- user_role_old enum — see 00052). Idempotent throughout.

-- ============================================================
-- Enums (new types — safe to create + use in one transaction).
-- ============================================================
DO $$ BEGIN
  CREATE TYPE ota_state AS ENUM (
    'pending', 'notified', 'downloading', 'downloaded',
    'awaiting_idle', 'installing', 'installed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ota_deployment_status AS ENUM ('pending', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE release_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ota_target_kind AS ENUM ('all', 'org', 'device_set');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- devices — the registry. device_uuid (SecureStore UUID) is the real identity;
-- organization_id is NULL until manually assigned. device_token_hash is the HMAC of
-- device_uuid the backend issues on first registration and verifies on every check-in.
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_uuid        TEXT         NOT NULL UNIQUE,
  organization_id    UUID         REFERENCES organizations(id),
  name               TEXT,
  android_id         TEXT,
  model              TEXT,
  manufacturer       TEXT,
  os_version         TEXT,
  app_version        TEXT,
  version_code       INTEGER,
  push_token         TEXT,
  device_token_hash  TEXT         NOT NULL,
  is_device_owner    BOOLEAN      NOT NULL DEFAULT false,
  last_seen_at       TIMESTAMPTZ,
  last_checkin_at    TIMESTAMPTZ,
  last_active_trip   BOOLEAN      NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_devices_org
  ON devices (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_devices_last_seen
  ON devices (last_seen_at)
  WHERE deleted_at IS NULL;

-- ============================================================
-- app_releases — an uploaded APK. version_code UNIQUE prevents two releases claiming the
-- same code and blocks accidental downgrade collisions. The APK file lives under
-- UPLOADS_ROOT/apks/ (apk_key); sha256 is verified on-device before install.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_releases (
  id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  version       TEXT            NOT NULL,
  version_code  INTEGER         NOT NULL,
  apk_key       TEXT            NOT NULL,
  sha256        TEXT            NOT NULL,
  size_bytes    BIGINT          NOT NULL,
  changelog     TEXT,
  mandatory     BOOLEAN         NOT NULL DEFAULT false,
  status        release_status  NOT NULL DEFAULT 'draft',
  uploaded_by   UUID            REFERENCES users(id),
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_releases_version_code
  ON app_releases (version_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_releases_status
  ON app_releases (status)
  WHERE deleted_at IS NULL;

-- ============================================================
-- ota_deployments — one release pushed/scheduled to a set of devices.
--   target_kind = all        → every (non-deleted) device
--               = org         → devices where organization_id = target_org_id
--               = device_set  → devices in target_device_ids[]
--   scheduled_at NULL = immediate; otherwise a BullMQ-delayed job flips status→active.
--   force_now bypasses the device idle gate (installs even mid-trip).
-- ============================================================
CREATE TABLE IF NOT EXISTS ota_deployments (
  id                 UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  release_id         UUID                   NOT NULL REFERENCES app_releases(id),
  target_kind        ota_target_kind        NOT NULL,
  target_org_id      UUID                   REFERENCES organizations(id),
  target_device_ids  UUID[],
  scheduled_at       TIMESTAMPTZ,
  force_now          BOOLEAN                NOT NULL DEFAULT false,
  status             ota_deployment_status  NOT NULL DEFAULT 'pending',
  created_by         UUID                   REFERENCES users(id),
  created_at         TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ            NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ota_deployments_status
  ON ota_deployments (status);

-- ============================================================
-- device_ota_status — the per-device state-machine instance for one deployment.
-- The DEVICE drives forward transitions (reported on check-in); the backend only sets
-- pending→notified and confirms `installed` on versionCode proof.
-- ============================================================
CREATE TABLE IF NOT EXISTS device_ota_status (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id  UUID         NOT NULL REFERENCES ota_deployments(id),
  device_id      UUID         NOT NULL REFERENCES devices(id),
  state          ota_state    NOT NULL DEFAULT 'pending',
  error          TEXT,
  attempt        INTEGER      NOT NULL DEFAULT 0,
  notified_at    TIMESTAMPTZ,
  downloaded_at  TIMESTAMPTZ,
  installed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_ota_status_device
  ON device_ota_status (device_id, state);

CREATE INDEX IF NOT EXISTS idx_device_ota_status_deployment
  ON device_ota_status (deployment_id, state);

-- ============================================================
-- RLS. Backend = table owner (bypasses RLS). Only `devices` gets a permissive read for
-- a future org-admin path; the OTA tables are super-admin/service-role only.
-- ============================================================
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_ota_status ENABLE ROW LEVEL SECURITY;

-- An org admin may read its own assigned devices (rows with NULL org stay invisible).
DROP POLICY IF EXISTS admin_read_devices ON devices;
CREATE POLICY admin_read_devices ON devices FOR SELECT
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

-- 00054_auxiliary_trucks.sql
-- External trip-request portal + one-time "auxiliary" trucks.
--
-- An outside company submits a pickup request through a per-org, code-protected
-- public page (/<slug>/request). An admin confirms it, which spins up a one-time
-- `machines` row (is_auxiliary=true) that flows through the existing task-board /
-- loader / CMR machinery — but with a COLLAPSED lifecycle: the loader finishes
-- loading ⇒ trip = completed (no arrive/depot/receiver step), and the driver
-- (who has NO app account) signs via a public link that finalizes stage-2 of the
-- document.
--
-- All flow logic lives in the backend (trip-requests.service + trips.service
-- aux branches). This migration only adds schema + defense-in-depth RLS. New-request
-- alerts reuse category='system' (no alert_category enum change — ADD VALUE is not
-- safe under --single-transaction). Idempotent throughout.

-- ============================================================
-- organizations — per-org request portal config.
--   request_access_code : the 4-digit code that gates /<slug>/request
--   allowed_crop_types  : subset of the crop_type enum the portal offers
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS request_access_code TEXT;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allowed_crop_types crop_type[] NOT NULL DEFAULT '{}';

-- ============================================================
-- machines — flag a one-time auxiliary truck. A normal truck has a permanently
-- linked driver user (users.assigned_machine_id); an auxiliary truck never does.
-- ============================================================
ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS is_auxiliary BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_machines_auxiliary
  ON machines (organization_id)
  WHERE deleted_at IS NULL AND is_auxiliary = true;

-- ============================================================
-- request_status enum (new type — safe to create + use in one transaction).
-- ============================================================
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('pending', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- trip_requests — the external pickup request. Org-scoped, soft-delete.
-- NOT synced to mobile. INSERT happens only via the backend (table owner,
-- bypasses RLS), so there is no public-insert policy.
-- ============================================================
CREATE TABLE IF NOT EXISTS trip_requests (
  id                       UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id          UUID            NOT NULL REFERENCES organizations(id),
  status                   request_status  NOT NULL DEFAULT 'pending',
  -- who is requesting
  requester_name           TEXT            NOT NULL,
  requester_phone          TEXT            NOT NULL,
  requester_email          TEXT,
  company_name             TEXT,
  company_address          TEXT,
  company_cui              TEXT,
  -- their truck
  truck_registration_plate TEXT            NOT NULL,
  truck_make               TEXT,
  truck_model              TEXT,
  truck_capacity_tons      NUMERIC(10,2),
  -- their driver (no app account)
  driver_name              TEXT            NOT NULL,
  driver_phone             TEXT            NOT NULL,
  driver_email             TEXT,
  -- the ask
  crop_type                crop_type,
  needed_date              DATE,
  tons_requested           NUMERIC(10,2),
  destination_address      TEXT,
  destination_locality     TEXT,
  destination_coords       GEOMETRY(Point, 4326),
  notes                    TEXT,
  -- linkage, filled on confirm
  machine_id               UUID            REFERENCES machines(id),
  trip_id                  UUID            REFERENCES trips(id),
  confirmed_by             UUID            REFERENCES users(id),
  confirmed_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancellation_reason      TEXT,
  created_at               TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trip_requests_org
  ON trip_requests (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trip_requests_status
  ON trip_requests (organization_id, status)
  WHERE deleted_at IS NULL;

-- ============================================================
-- trips — account-less driver + collapsed-lifecycle support.
-- driver_id becomes nullable: an auxiliary trip has no user driver, only the
-- external_driver_* contact captured from the request. The public_sign_token is
-- the one-time link the driver uses to confirm + sign (finalizing stage-2 CMR).
-- ============================================================
ALTER TABLE trips ALTER COLUMN driver_id DROP NOT NULL;

ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_auxiliary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS external_driver_name TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS external_driver_phone TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS external_driver_email TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_sign_token TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_sign_token_used_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_request_id UUID REFERENCES trip_requests(id);

-- One-time token must be globally unique when present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_public_sign_token
  ON trips (public_sign_token)
  WHERE public_sign_token IS NOT NULL;

-- Loader's "auxiliary trucks to load" query (loader_id + is_auxiliary + open status).
CREATE INDEX IF NOT EXISTS idx_trips_aux_loader
  ON trips (loader_id)
  WHERE deleted_at IS NULL AND is_auxiliary = true;

-- ============================================================
-- RLS — trip_requests. Defense-in-depth ONLY: the NestJS backend connects as the
-- table owner via DATABASE_URL and BYPASSES RLS (it is the sole writer, incl. the
-- public submission path). These policies matter only for a direct PostgREST /
-- Realtime path carrying an admin/dispatcher JWT.
--
-- ::text cast on user_role() is REQUIRED (stale user_role_old enum — see 00052).
-- ============================================================
ALTER TABLE trip_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_trip_requests ON trip_requests;
CREATE POLICY admin_all_trip_requests ON trip_requests FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_trip_requests ON trip_requests;
CREATE POLICY dispatcher_read_trip_requests ON trip_requests FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_update_trip_requests ON trip_requests;
CREATE POLICY dispatcher_update_trip_requests ON trip_requests FOR UPDATE
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

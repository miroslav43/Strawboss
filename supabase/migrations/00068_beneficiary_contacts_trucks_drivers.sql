-- 00068_beneficiary_contacts_trucks_drivers.sql
-- Per-beneficiary reusable Contact / Truck+Transporter / Driver records, managed
-- from the public PIN-gated request portal so a beneficiary's coordinator can pick
-- them from dropdowns instead of re-typing them on every request.
--
-- Org + beneficiary scoped, soft-delete. Mirrors beneficiaries (00061) and reuses the
-- cross-org composite FK hardening of 00063. NOT synced to mobile (admin catalog).
-- The NestJS backend connects as table owner and bypasses RLS; the policies below
-- are defense-in-depth for any direct PostgREST/Realtime admin/dispatcher JWT.

-- ── beneficiary_contacts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beneficiary_contacts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiary_id   UUID        NOT NULL,
  name             TEXT        NOT NULL,
  phone            TEXT,
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT beneficiary_contacts_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT beneficiary_contacts_beneficiary_org_fkey
    FOREIGN KEY (organization_id, beneficiary_id)
    REFERENCES beneficiaries (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_contacts_ben
  ON beneficiary_contacts(beneficiary_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_beneficiary_contacts_org
  ON beneficiary_contacts(organization_id);

-- ── beneficiary_trucks (truck + transporter company bundled) ─────────────────

CREATE TABLE IF NOT EXISTS beneficiary_trucks (
  id                         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiary_id             UUID          NOT NULL,
  truck_registration_plate   TEXT          NOT NULL,
  trailer_registration_plate TEXT,
  capacity_tons              NUMERIC(10,2),
  transporter_name           TEXT,
  transporter_cui            TEXT,
  transporter_address        TEXT,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at                 TIMESTAMPTZ,
  CONSTRAINT beneficiary_trucks_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT beneficiary_trucks_beneficiary_org_fkey
    FOREIGN KEY (organization_id, beneficiary_id)
    REFERENCES beneficiaries (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_trucks_ben
  ON beneficiary_trucks(beneficiary_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_beneficiary_trucks_org
  ON beneficiary_trucks(organization_id);

-- ── beneficiary_drivers ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beneficiary_drivers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiary_id   UUID        NOT NULL,
  name             TEXT        NOT NULL,
  phone            TEXT,
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT beneficiary_drivers_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT beneficiary_drivers_beneficiary_org_fkey
    FOREIGN KEY (organization_id, beneficiary_id)
    REFERENCES beneficiaries (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_drivers_ben
  ON beneficiary_drivers(beneficiary_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_beneficiary_drivers_org
  ON beneficiary_drivers(organization_id);

-- ── Traceability FKs on trip_requests (nullable, no behavior change) ──────────
-- Lets dispatch see which saved record a submitted request came from. Composite
-- (organization_id, X_id) FKs reuse each table's org_id_key for the same cross-org
-- guard as 00063; MATCH SIMPLE skips the check when the id is NULL.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS contact_id UUID,
  ADD COLUMN IF NOT EXISTS truck_id   UUID,
  ADD COLUMN IF NOT EXISTS driver_id  UUID;

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_contact_org_fkey;
ALTER TABLE trip_requests ADD CONSTRAINT trip_requests_contact_org_fkey
  FOREIGN KEY (organization_id, contact_id)
  REFERENCES beneficiary_contacts (organization_id, id);

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_truck_org_fkey;
ALTER TABLE trip_requests ADD CONSTRAINT trip_requests_truck_org_fkey
  FOREIGN KEY (organization_id, truck_id)
  REFERENCES beneficiary_trucks (organization_id, id);

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_driver_org_fkey;
ALTER TABLE trip_requests ADD CONSTRAINT trip_requests_driver_org_fkey
  FOREIGN KEY (organization_id, driver_id)
  REFERENCES beneficiary_drivers (organization_id, id);

-- ── RLS (defense-in-depth, mirrors beneficiaries 00061) ──────────────────────
-- Read: admin / dispatcher / super_admin of the same org.
-- Write: admin / super_admin of the same org (WITH CHECK mirrors USING).

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['beneficiary_contacts', 'beneficiary_trucks', 'beneficiary_drivers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_org_read', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        FOR SELECT
        USING (
          organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
          AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid)
                IN ('admin', 'dispatcher', 'super_admin')
        )
    $f$, tbl || '_org_read', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_org_write', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        FOR ALL
        USING (
          organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
          AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid)
                IN ('admin', 'super_admin')
        )
        WITH CHECK (
          organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
          AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid)
                IN ('admin', 'super_admin')
        )
    $f$, tbl || '_org_write', tbl);
  END LOOP;
END $$;

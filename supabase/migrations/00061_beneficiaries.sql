-- 00061_beneficiaries.sql
-- Per-org buyer companies with per-beneficiary public request URLs and daily PINs.

-- ── beneficiaries table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beneficiaries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug             TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  company_name     TEXT        NOT NULL,
  company_address  TEXT,
  company_cui      TEXT,
  daily_pin        CHAR(4)     NOT NULL DEFAULT lpad((floor(random() * 10000))::int::text, 4, '0'),
  pin_generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT beneficiaries_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_org
  ON beneficiaries(organization_id)
  WHERE deleted_at IS NULL;

-- ── Extra columns on trip_requests ──────────────────────────────────────────

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS beneficiary_id             UUID REFERENCES beneficiaries(id),
  ADD COLUMN IF NOT EXISTS trailer_registration_plate TEXT,
  ADD COLUMN IF NOT EXISTS transporter_cui            TEXT,
  ADD COLUMN IF NOT EXISTS transporter_name           TEXT,
  ADD COLUMN IF NOT EXISTS transporter_address        TEXT;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;

-- Read: admin, dispatcher, super_admin of the same org
CREATE POLICY "beneficiaries_org_read" ON beneficiaries
  FOR SELECT
  USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid)
          IN ('admin', 'dispatcher', 'super_admin')
  );

-- Write (insert/update/delete): admin, super_admin of the same org
CREATE POLICY "beneficiaries_org_write" ON beneficiaries
  FOR ALL
  USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid)
          IN ('admin', 'super_admin')
  );

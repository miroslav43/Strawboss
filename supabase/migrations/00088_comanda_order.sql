-- 00088_comanda_order.sql
--
-- Auto-generated "comandă" (transport order) PDF for the transporter feature:
--   1. a new `comanda` document_type (the generated order lives in `documents`);
--   2. `beneficiary_order_settings` — per-beneficiary order fields the transporter
--      configures once (price, payment term, bale count/dimensions, goods name,
--      truck description, loading place, OBS) + a running order counter;
--   3. two columns on `trip_requests`: the typed `unloading_date` and the assigned
--      `comanda_order_no` (set once so regeneration is idempotent).
--
-- Backend bypasses RLS (table owner); the policies are defense-in-depth for direct
-- PostgREST/Realtime access with a user JWT, using the current `users`-subquery
-- convention (00068) that sidesteps the stale public.user_role() enum.
--
-- `ALTER TYPE ... ADD VALUE` is not USED (cast to the enum) in this migration — the
-- new columns are DATE/INT, RLS compares text — so it is safe under the runner's
-- single-transaction wrapper (same reasoning as 00083 / 00087).

-- ── 1. document_type label ───────────────────────────────────────────────────
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'comanda';

-- ── 2. beneficiary_order_settings (singleton per beneficiary) ────────────────
CREATE TABLE IF NOT EXISTS beneficiary_order_settings (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiary_id     UUID          NOT NULL,
  transport_value    NUMERIC(12,2),
  currency           TEXT          NOT NULL DEFAULT 'EUR',
  payment_term_days  INT           NOT NULL DEFAULT 30,
  bale_count         INT,
  bale_dimensions    TEXT,
  goods_name         TEXT,
  truck_description  TEXT,
  loading_locality   TEXT,
  loading_country    TEXT,
  obs                TEXT,
  order_counter      INT           NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT beneficiary_order_settings_uniq UNIQUE (organization_id, beneficiary_id),
  CONSTRAINT beneficiary_order_settings_ben_org_fkey
    FOREIGN KEY (organization_id, beneficiary_id)
    REFERENCES beneficiaries (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_order_settings_ben
  ON beneficiary_order_settings(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_order_settings_org
  ON beneficiary_order_settings(organization_id);

-- ── 3. trip_requests: unloading date + assigned comandă number ───────────────
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS unloading_date   DATE,
  ADD COLUMN IF NOT EXISTS comanda_order_no INT;

-- ── 4. RLS (defense-in-depth) ────────────────────────────────────────────────
ALTER TABLE beneficiary_order_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beneficiary_order_settings_admin_all ON beneficiary_order_settings;
CREATE POLICY beneficiary_order_settings_admin_all ON beneficiary_order_settings
  FOR ALL
  USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid) IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND (SELECT role::text FROM users WHERE id = auth.uid()::uuid) IN ('admin', 'super_admin')
  );

-- A transporter may read/write order settings only for beneficiaries they are
-- assigned to (transporter_beneficiaries), in their own org.
DROP POLICY IF EXISTS beneficiary_order_settings_transporter_all ON beneficiary_order_settings;
CREATE POLICY beneficiary_order_settings_transporter_all ON beneficiary_order_settings
  FOR ALL
  USING (
    (SELECT role::text FROM users WHERE id = auth.uid()::uuid) = 'transportator'
    AND organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND beneficiary_id IN (
      SELECT beneficiary_id FROM transporter_beneficiaries
      WHERE transporter_user_id = auth.uid()::uuid
    )
  )
  WITH CHECK (
    (SELECT role::text FROM users WHERE id = auth.uid()::uuid) = 'transportator'
    AND organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::uuid)
    AND beneficiary_id IN (
      SELECT beneficiary_id FROM transporter_beneficiaries
      WHERE transporter_user_id = auth.uid()::uuid
    )
  );

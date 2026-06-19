-- 00053_depot_confirmation.sql
-- Depot-operator delivery confirmation (driver → operator depozit).
--
-- Mirrors the loader↔driver bale handshake for driver↔depot-operator at delivery
-- time. A depot_manager assigned to a trip's destination depot confirms the bale
-- count the truck arrived with (+ gross/tare on a "principal" depot, or only the
-- count when "temporary" or the scale is broken), signs with their specimen, and
-- that single action drives the trip arrived→delivered→completed server-side.
--
-- This migration only adds the schema + defense-in-depth RLS. The flow logic lives
-- in the backend (trips.service confirmDepotDelivery). Idempotent throughout.

-- ============================================================
-- delivery_destinations — depot type + per-depot geofence confirm radius.
-- Default 'principal' / 300 m keeps every existing depot backward-compatible
-- (no operator assigned → drivers keep the current confirm-delivery flow).
-- ============================================================
ALTER TABLE delivery_destinations
  ADD COLUMN IF NOT EXISTS depot_type TEXT NOT NULL DEFAULT 'principal';

DO $$ BEGIN
  ALTER TABLE delivery_destinations ADD CONSTRAINT chk_depot_type
    CHECK (depot_type IN ('principal', 'temporary'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE delivery_destinations
  ADD COLUMN IF NOT EXISTS confirm_radius_m INTEGER NOT NULL DEFAULT 300;

DO $$ BEGIN
  ALTER TABLE delivery_destinations ADD CONSTRAINT chk_confirm_radius_pos
    CHECK (confirm_radius_m > 0 AND confirm_radius_m <= 20000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- trips — depot-confirmation audit columns.
--
-- The operator-confirmed bale count REUSES trips.bale_count (already synced and
-- already feeds the depot-inventory SUM(bale_count) aggregate), so no separate
-- delivered_bale_count column is needed. net_weight_kg is the existing generated
-- column (gross - tare); chk_net_weight_sane (00023) is already NULL-safe, so a
-- temporary/scale-broken confirm writes gross=NULL, tare=NULL → net=NULL with no
-- constraint change required.
-- ============================================================
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS depot_operator_id UUID REFERENCES users(id);
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS depot_confirmed_at TIMESTAMPTZ;
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS depot_operator_signature_url TEXT;
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS scale_broken BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for "trips this operator confirmed". The destination owner filter
-- is already covered by idx_trips_destination (00051).
CREATE INDEX IF NOT EXISTS idx_trips_depot_operator
  ON trips (depot_operator_id)
  WHERE deleted_at IS NULL AND depot_operator_id IS NOT NULL;

-- ============================================================
-- RLS — depot_manager SELECT + UPDATE on trips bound to their assigned depot.
--
-- Defense-in-depth ONLY: the NestJS backend connects as the table owner via
-- DATABASE_URL and BYPASSES RLS. Real enforcement is in trips.service
-- confirmDepotDelivery (ensureUserCanAccessDepot pattern + server geofence check).
-- These policies matter only for any direct PostgREST/Realtime path with a
-- depot_manager JWT (it currently has no trips policy → sees nothing).
--
-- ::text cast is REQUIRED: public.user_role() is still bound to the stale
-- user_role_old enum (00009/00052), which lacks 'depot_manager'; a bare
-- `= 'depot_manager'` would fail to even CREATE. Mirrors 00052.
-- ============================================================
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depot_manager_read_trips ON trips;
CREATE POLICY depot_manager_read_trips ON trips FOR SELECT
  USING (
    public.user_role()::text = 'depot_manager'
    AND organization_id = public.user_org_id()
    AND destination_id = (
      SELECT u.assigned_delivery_destination_id
        FROM users u
       WHERE u.id = public.user_id()
         AND u.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS depot_manager_update_trips ON trips;
CREATE POLICY depot_manager_update_trips ON trips FOR UPDATE
  USING (
    public.user_role()::text = 'depot_manager'
    AND organization_id = public.user_org_id()
    AND destination_id = (
      SELECT u.assigned_delivery_destination_id
        FROM users u
       WHERE u.id = public.user_id()
         AND u.deleted_at IS NULL
    )
  )
  WITH CHECK (
    public.user_role()::text = 'depot_manager'
    AND organization_id = public.user_org_id()
    AND destination_id = (
      SELECT u.assigned_delivery_destination_id
        FROM users u
       WHERE u.id = public.user_id()
         AND u.deleted_at IS NULL
    )
  );
-- NOTE: when assigned_delivery_destination_id IS NULL the subquery yields NULL, so
-- `destination_id = NULL` is never true and an unassigned depot_manager sees/edits
-- no trips.

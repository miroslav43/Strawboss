-- 00052_rls_org_scoping.sql
-- Scope the admin & dispatcher RLS policies by organization_id.
--
-- WHY: migration 00036 made the app multi-tenant (added organization_id to all
-- entity tables) but the policies from 00008/00009/00022 still check ONLY the
-- role (`user_role() = 'admin'` / `'dispatcher'`) with no org filter. Because the
-- backend runs on the service role (which BYPASSES RLS), these policies are the
-- only DB-level tenant boundary — and they leak across orgs via:
--   (a) Supabase Realtime (admin-web subscriptions receive every org's changes),
--   (b) any direct PostgREST / supabase-js query carrying a user JWT.
--
-- WHAT: rewrite every admin_all_* / dispatcher_* policy on an org-columned table
-- to add `AND organization_id = public.user_org_id()`. Tables without an
-- organization_id column are scoped through a join (parcels / machines).
--
-- SUPER ADMIN: the `super_admin` role is a DISTINCT role value with
-- organization_id = NULL. It never matched `user_role() = 'admin'`, so it never
-- had access through these policies (super-admin actions go through the backend
-- service role). We deliberately do NOT grant it new direct PostgREST access
-- here — behaviour is preserved, attack surface is not widened.
--
-- CAVEAT (re-login window): user_org_id() reads the organization_id claim that
-- the 00038 JWT hook injects into app_metadata. Tokens issued before 00038, or
-- before the hook was wired in the Supabase dashboard, lack the claim → the
-- function returns NULL → org-scoped reads return nothing until the token
-- refreshes (Supabase access tokens are ~1h TTL). Verify the Custom Access Token
-- hook is active before applying.
--
-- NOT covered (no organization_id column, low cross-org value — handled by the
-- service-role backend): farmtrack_events, sync_idempotency, audit_logs,
-- geofence_events. Revisit if any of these is ever exposed via PostgREST.
--
-- ROLE CHECKS USE ::text — NOTE: public.user_role() is still bound to the STALE
-- `user_role_old` enum {admin,baler_operator,loader_operator,driver} (migration
-- 00009 renamed the type but never recreated the function), so the current roles
-- dispatcher/geofence_maker/super_admin/depot_manager are NOT in its return type.
-- A literal `public.user_role() = 'dispatcher'` therefore fails to even CREATE.
-- Casting to text (`public.user_role()::text = '...'`) sidesteps enum resolution
-- and is correct for whatever the runtime value resolves to. Fixing user_role()'s
-- return type itself is a separate, more invasive migration (it would require
-- dropping every dependent policy first) — tracked as a follow-up.

-- ============================================================
-- Helper: organization_id of the calling user, from the JWT claim.
-- Mirrors public.user_role(); NULL when the claim is absent (fail-closed).
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_org_id() RETURNS UUID AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json
      -> 'app_metadata' ->> 'organization_id',
    ''
  )::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- ADMIN — full CRUD, now scoped to the admin's own organization.
-- ============================================================
DROP POLICY IF EXISTS admin_all_users ON users;
CREATE POLICY admin_all_users ON users FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_parcels ON parcels;
CREATE POLICY admin_all_parcels ON parcels FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_machines ON machines;
CREATE POLICY admin_all_machines ON machines FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_delivery_dest ON delivery_destinations;
CREATE POLICY admin_all_delivery_dest ON delivery_destinations FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_task_assignments ON task_assignments;
CREATE POLICY admin_all_task_assignments ON task_assignments FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_trips ON trips;
CREATE POLICY admin_all_trips ON trips FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_bale_loads ON bale_loads;
CREATE POLICY admin_all_bale_loads ON bale_loads FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_bale_productions ON bale_productions;
CREATE POLICY admin_all_bale_productions ON bale_productions FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_fuel_logs ON fuel_logs;
CREATE POLICY admin_all_fuel_logs ON fuel_logs FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_consumable_logs ON consumable_logs;
CREATE POLICY admin_all_consumable_logs ON consumable_logs FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_documents ON documents;
CREATE POLICY admin_all_documents ON documents FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS admin_all_alerts ON alerts;
CREATE POLICY admin_all_alerts ON alerts FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

-- ============================================================
-- DISPATCHER — reads + trip/task management, scoped to own org.
-- ============================================================
DROP POLICY IF EXISTS dispatcher_read_users ON users;
CREATE POLICY dispatcher_read_users ON users FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_parcels ON parcels;
CREATE POLICY dispatcher_read_parcels ON parcels FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_machines ON machines;
CREATE POLICY dispatcher_read_machines ON machines FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_delivery_dest ON delivery_destinations;
CREATE POLICY dispatcher_read_delivery_dest ON delivery_destinations FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_trips ON trips;
CREATE POLICY dispatcher_read_trips ON trips FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_bale_loads ON bale_loads;
CREATE POLICY dispatcher_read_bale_loads ON bale_loads FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_bale_productions ON bale_productions;
CREATE POLICY dispatcher_read_bale_productions ON bale_productions FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_fuel_logs ON fuel_logs;
CREATE POLICY dispatcher_read_fuel_logs ON fuel_logs FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_consumable_logs ON consumable_logs;
CREATE POLICY dispatcher_read_consumable_logs ON consumable_logs FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_documents ON documents;
CREATE POLICY dispatcher_read_documents ON documents FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_read_alerts ON alerts;
CREATE POLICY dispatcher_read_alerts ON alerts FOR SELECT
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_crud_task_assignments ON task_assignments;
CREATE POLICY dispatcher_crud_task_assignments ON task_assignments FOR ALL
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_update_trips ON trips;
CREATE POLICY dispatcher_update_trips ON trips FOR UPDATE
  USING (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS dispatcher_insert_trips ON trips;
CREATE POLICY dispatcher_insert_trips ON trips FOR INSERT
  WITH CHECK (public.user_role()::text = 'dispatcher' AND organization_id = public.user_org_id());

-- ============================================================
-- 00022 fixes — farms & parcel_daily_status had USING (true) SELECT policies
-- (full cross-org read). Scope them to the caller's org.
-- ============================================================
DROP POLICY IF EXISTS admin_all_farms ON farms;
CREATE POLICY admin_all_farms ON farms FOR ALL
  USING (public.user_role()::text = 'admin' AND organization_id = public.user_org_id())
  WITH CHECK (public.user_role()::text = 'admin' AND organization_id = public.user_org_id());

DROP POLICY IF EXISTS read_farms ON farms;
CREATE POLICY read_farms ON farms FOR SELECT
  USING (organization_id = public.user_org_id());

-- parcel_daily_status has no organization_id — scope via its parcel.
DROP POLICY IF EXISTS admin_all_pds ON parcel_daily_status;
CREATE POLICY admin_all_pds ON parcel_daily_status FOR ALL
  USING (
    public.user_role()::text = 'admin'
    AND EXISTS (
      SELECT 1 FROM parcels p
      WHERE p.id = parcel_daily_status.parcel_id
        AND p.organization_id = public.user_org_id()
    )
  )
  WITH CHECK (
    public.user_role()::text = 'admin'
    AND EXISTS (
      SELECT 1 FROM parcels p
      WHERE p.id = parcel_daily_status.parcel_id
        AND p.organization_id = public.user_org_id()
    )
  );

DROP POLICY IF EXISTS read_all_pds ON parcel_daily_status;
CREATE POLICY read_all_pds ON parcel_daily_status FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM parcels p
      WHERE p.id = parcel_daily_status.parcel_id
        AND p.organization_id = public.user_org_id()
    )
  );

-- ============================================================
-- 00009 — machine_location_events has no organization_id. Scope the admin
-- policy through the owning machine. The operator-own policy already limits
-- non-admins to their own events.
-- ============================================================
DROP POLICY IF EXISTS mle_admin_all ON machine_location_events;
CREATE POLICY mle_admin_all ON machine_location_events FOR ALL
  USING (
    public.user_role()::text = 'admin'
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_location_events.machine_id
        AND m.organization_id = public.user_org_id()
    )
  )
  WITH CHECK (
    public.user_role()::text = 'admin'
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_location_events.machine_id
        AND m.organization_id = public.user_org_id()
    )
  );

-- ============================================================
-- 00036 — the organizations table had NO RLS, so any authenticated user could
-- enumerate every tenant. Restrict SELECT to the caller's own organization.
-- (super_admin / cross-org listing continues through the service-role backend.)
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_read_own ON organizations;
CREATE POLICY org_read_own ON organizations FOR SELECT
  USING (id = public.user_org_id());

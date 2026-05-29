-- 00047_depot_manager_rls_policies.sql
-- Defense-in-depth: scope depot_manager SELECT on delivery_destinations to the
-- single depot assigned via users.assigned_delivery_destination_id (00046).
--
-- IMPORTANT: this is NOT the primary access control for the depot endpoints.
-- The NestJS backend connects as the table owner via DATABASE_URL and BYPASSES
-- RLS entirely; the real enforcement lives in deposit-inventory.service.ts
-- (ensureUserCanAccessDepot / listDepotsForOrg) and admin-users.service.ts.
-- This policy only matters for any path that reads delivery_destinations
-- directly through Supabase PostgREST/Realtime with a depot_manager user JWT.
--
-- RLS policies are OR-combined per command, so this additive SELECT policy does
-- not affect the existing admin (FOR ALL), dispatcher (SELECT) or driver (SELECT)
-- access on this table. depot_manager previously had NO policy and therefore saw
-- nothing via direct Supabase reads.

ALTER TABLE delivery_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depot_manager_read_own_dest ON delivery_destinations;
CREATE POLICY depot_manager_read_own_dest ON delivery_destinations
  FOR SELECT
  USING (
    public.user_role() = 'depot_manager'
    AND id = (
      SELECT u.assigned_delivery_destination_id
        FROM users u
       WHERE u.id = public.user_id()
         AND u.deleted_at IS NULL
    )
  );
-- NOTE: when assigned_delivery_destination_id IS NULL the subquery yields NULL,
-- so `id = NULL` is never true and an unassigned depot_manager sees no rows.

-- 00079_fix_user_role_stale_enum.sql
--
-- Corrective fix for a bug already documented in 00052_rls_org_scoping.sql's
-- header comment: `public.user_role()` (created in 00008_rls_policies.sql,
-- BEFORE 00009_roles_gps.sql renamed+recreated the `user_role` type) is still
-- bound to the pre-00009 enum, now named `user_role_old`. Every subsequent
-- role added via `ALTER TYPE user_role ADD VALUE` (00033 geofence_maker,
-- 00037 super_admin, 00043 depot_manager) targeted the NEW `user_role` type
-- that `users.role` actually uses — not `user_role_old` — so
-- `public.user_role()` can never return those values, and any RLS policy
-- comparing `public.user_role() = 'dispatcher'` / `'geofence_maker'` /
-- `'super_admin'` / `'depot_manager'` WITHOUT an explicit `::text` cast fails
-- to even evaluate ("invalid input value for enum user_role_old").
--
-- The full fix (recreate `public.user_role()` to RETURN text, then
-- `DROP TYPE user_role_old`, then recreate every dependent RLS policy) is a
-- large, invasive change — 00052 itself deliberately deferred it ("tracked
-- as a follow-up") rather than risk getting a recreated policy's scope
-- subtly wrong without a scratch-DB replay to verify against. This migration
-- instead adds the missing labels directly to `user_role_old` (the type
-- `public.user_role()` already returns) — purely additive, no DROP, no
-- existing policy touched or recreated — which is enough to satisfy the
-- acceptance criterion (RLS for these four roles evaluates without error)
-- without that surgery, and as a side effect also fixes any already-existing
-- uncast policy (e.g. 00047_depot_manager_rls_policies.sql's
-- `public.user_role() = 'depot_manager'`) with zero changes to that file.
--
-- NEEDS-DB-VERIFICATION: written from static analysis of the migration
-- history plus 00052's documented finding — no live/scratch DB connection
-- was available in this environment to run the health check the audit plan
-- calls for. Before relying on this in production, confirm against the live
-- DB:
--   SELECT pg_catalog.format_type(prorettype, NULL) FROM pg_proc WHERE proname = 'user_role';
--   SELECT enum_range(NULL::user_role_old);
-- If the bound type's name or current labels differ from what's assumed
-- here, adjust the ALTER TYPE target below accordingly. This migration fails
-- loudly (does not silently corrupt anything) if `user_role_old` does not
-- exist under that name.
--
-- `ALTER TYPE ... ADD VALUE` cannot have its new value used within the same
-- transaction it was added in — this migration only adds values, it never
-- uses them, so it is safe to run inside the migration runner's
-- `psql --single-transaction` wrapper (same reasoning as 00043's).

ALTER TYPE user_role_old ADD VALUE IF NOT EXISTS 'dispatcher';
ALTER TYPE user_role_old ADD VALUE IF NOT EXISTS 'geofence_maker';
ALTER TYPE user_role_old ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE user_role_old ADD VALUE IF NOT EXISTS 'depot_manager';

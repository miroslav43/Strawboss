-- 00013_jwt_role_hook.sql
-- Supabase Custom Access Token Hook.
-- Injects the app role from public.users into the JWT's app_metadata.role claim
-- so the backend AuthGuard can read it from the token.
--
-- After applying this migration you MUST enable the hook in Supabase:
--   Dashboard → Authentication → Hooks → Custom Access Token
--   Function: public.custom_access_token_hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_role text;
BEGIN
  -- Look up the role from the application users table.
  SELECT role::text INTO app_role
  FROM public.users
  WHERE id = (event->>'user_id')::uuid
    AND deleted_at IS NULL;

  -- Inject into claims.app_metadata.role only if the user exists in our table.
  IF app_role IS NOT NULL THEN
    event := jsonb_set(
      event,
      '{claims,app_metadata,role}',
      to_jsonb(app_role)
    );
  END IF;

  RETURN event;
END;
$$;

-- Grant execute to the Supabase auth admin role (required for the hook to fire).
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;

-- supabase_auth_admin must be able to read the users table to look up the role.
GRANT SELECT ON public.users TO supabase_auth_admin;

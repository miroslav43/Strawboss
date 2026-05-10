-- supabase/migrations/00038_jwt_org_hook.sql
-- Extends the JWT hook to inject organization_id and organization_slug
-- into app_metadata so the backend and frontend can read them from the token.
--
-- After applying: re-save the hook in Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token → Function: public.custom_access_token_hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_role text;
  org_id   uuid;
  org_slug text;
BEGIN
  SELECT u.role::text, u.organization_id
  INTO app_role, org_id
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid
    AND u.deleted_at IS NULL;

  IF app_role IS NOT NULL THEN
    event := jsonb_set(event, '{claims,app_metadata,role}', to_jsonb(app_role));
  END IF;

  IF org_id IS NOT NULL THEN
    event := jsonb_set(
      event,
      '{claims,app_metadata,organization_id}',
      to_jsonb(org_id::text)
    );

    SELECT o.slug INTO org_slug
    FROM public.organizations o
    WHERE o.id = org_id AND o.deleted_at IS NULL;

    IF org_slug IS NOT NULL THEN
      event := jsonb_set(
        event,
        '{claims,app_metadata,organization_slug}',
        to_jsonb(org_slug)
      );
    END IF;
  END IF;

  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
GRANT SELECT ON public.users TO supabase_auth_admin;
GRANT SELECT ON public.organizations TO supabase_auth_admin;

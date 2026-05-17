import type { Session } from '@supabase/supabase-js';
import { apiV1Url } from '@/lib/api';

type AppOrgMeta = { role?: string; organization_slug?: string };

/** Load org slug from API when JWT does not include `app_metadata.organization_slug`. */
export async function fetchOrganizationSlugFromProfile(accessToken: string): Promise<string | null> {
  const res = await fetch(apiV1Url('/profile'), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { organizationSlug?: string | null };
  const slug = data.organizationSlug;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

/** Resolves tenant slug for dashboard routing (not used for super_admin — caller handles that). */
export async function resolveOrganizationSlugForSession(session: Session): Promise<string | null> {
  const appMeta = session.user.app_metadata as AppOrgMeta;
  if (appMeta.role === 'super_admin') return null;
  const fromJwt = appMeta.organization_slug;
  if (fromJwt && typeof fromJwt === 'string') return fromJwt;
  return fetchOrganizationSlugFromProfile(session.access_token);
}

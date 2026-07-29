'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useFeatures } from '@/hooks/useFeatures';
import { navFeatureForPath } from './Sidebar';

/**
 * Sends a user away from a page whose module the organization has switched off.
 *
 * Hiding the sidebar link is not enough on its own — a bookmark, a pasted URL
 * or a browser-history entry walks straight past it. There is no `middleware.ts`
 * in this app (every guard is a client layout), so this runs alongside the
 * existing auth guard rather than in front of it.
 *
 * ── WHY IT WAITS FOR `ready` ──────────────────────────────────────────────
 *
 * `useFeatures` reports everything enabled until the profile resolves. Acting
 * on that would be harmless; acting on the OPPOSITE assumption would not — so
 * the redirect only fires once the real answer is in. A user with full access
 * must never be bounced off a page because their profile had not loaded yet.
 *
 * The route/feature mapping is derived from the sidebar's own item list, so a
 * page can never be hidden from the menu while remaining reachable by URL.
 */
export function FeatureRouteGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const slug = useOrgSlug();
  const { isEnabled, ready } = useFeatures();

  useEffect(() => {
    if (!ready || !slug || !pathname) return;
    const feature = navFeatureForPath(slug, pathname);
    if (feature && !isEnabled(feature)) {
      // `replace`, not `push`: Back would otherwise bounce between the blocked
      // page and this redirect.
      router.replace(`/${slug}/command-center`);
    }
  }, [ready, slug, pathname, isEnabled, router]);

  return null;
}

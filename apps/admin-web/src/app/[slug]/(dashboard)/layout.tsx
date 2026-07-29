'use client';

// Dashboard pages are data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { RealtimeProvider } from '@/lib/realtime';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { RealtimeStatusBanner } from '@/components/layout/RealtimeStatusBanner';
import { ProfileLocaleHydration } from '@/components/layout/ProfileLocaleHydration';
import { FeatureRouteGuard } from '@/components/layout/FeatureRouteGuard';
import { supabase } from '@/lib/supabase';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';
import { useI18n } from '@/lib/i18n';

// Separated so it can use useI18n (which needs I18nProvider above it).
function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-neutral-50">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="text-sm text-neutral-500">{t('auth.checkingSession')}</span>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  // W19: start collapsed so mobile doesn't flash an open drawer on first render.
  // On sm+ the sidebar is always visible via sm:translate-x-0; open only controls
  // the desktop width (w-60 vs w-16) and the mobile drawer slide-in.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
        return;
      }

      if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
        queryClient.clear();
      }
      activeUserIdRef.current = session.user.id;

      const appMeta = session.user.app_metadata as {
        role?: string;
        organization_slug?: string;
      };

      // super_admin can access any org's dashboard
      if (appMeta.role === 'super_admin') {
        setReady(true);
        return;
      }

      const userSlug =
        appMeta.organization_slug ?? (await resolveOrganizationSlugForSession(session));
      if (!userSlug) {
        router.replace('/login');
        return;
      }
      if (userSlug !== params.slug) {
        router.replace(`/${userSlug}/`);
        return;
      }

      // A transporter has a dedicated minimal shell, never the admin dashboard.
      if (appMeta.role === 'transportator') {
        router.replace(`/${params.slug}/transport`);
        return;
      }

      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        if (!active) return;
        if (!session) {
          queryClient.clear();
          activeUserIdRef.current = null;
          setReady(false);
          router.replace('/login');
          return;
        }

        if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
          queryClient.clear();
        }
        activeUserIdRef.current = session.user.id;

        const appMeta = session.user.app_metadata as {
          role?: string;
          organization_slug?: string;
        };

        if (appMeta.role === 'super_admin') {
          setReady(true);
          return;
        }

        const userSlug =
          appMeta.organization_slug ?? (await resolveOrganizationSlugForSession(session));
        if (!userSlug) {
          router.replace('/login');
          return;
        }
        if (userSlug !== params.slug) {
          router.replace(`/${userSlug}/`);
          return;
        }

        // A transporter has a dedicated minimal shell, never the admin dashboard.
        if (appMeta.role === 'transportator') {
          router.replace(`/${params.slug}/transport`);
          return;
        }

        setReady(true);
      })();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, params.slug, queryClient]);

  return (
    <RealtimeProvider>
      {!ready ? (
        <LoadingScreen />
      ) : (
        <div className="flex h-screen">
          <ProfileLocaleHydration />
          {/* Deep-link protection for feature-gated pages. Hiding the sidebar
              link alone leaves a bookmarked or pasted URL fully reachable. */}
          <FeatureRouteGuard />

          {/* W19: mobile overlay — shown only when sidebar open on small screens */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-20 bg-black/40 sm:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />

          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onMenuClick={() => setSidebarOpen((v) => !v)} />
            {/* W15: realtime disconnection banner */}
            <RealtimeStatusBanner />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      )}
    </RealtimeProvider>
  );
}

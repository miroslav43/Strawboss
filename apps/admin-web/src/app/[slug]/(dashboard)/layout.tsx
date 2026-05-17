'use client';

// Dashboard pages are data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeProvider } from '@/lib/realtime';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ProfileLocaleHydration } from '@/components/layout/ProfileLocaleHydration';
import { supabase } from '@/lib/supabase';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
        <div className="flex h-screen items-center justify-center bg-neutral-50" />
      ) : (
        <div className="flex h-screen">
          <ProfileLocaleHydration />
          <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      )}
    </RealtimeProvider>
  );
}

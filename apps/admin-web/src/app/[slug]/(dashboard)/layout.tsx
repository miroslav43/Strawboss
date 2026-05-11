'use client';

// Dashboard pages are data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RealtimeProvider } from '@/lib/realtime';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ProfileLocaleHydration } from '@/components/layout/ProfileLocaleHydration';
import { supabase } from '@/lib/supabase';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
        return;
      }

      const appMeta = session.user.app_metadata as {
        role?: string;
        organization_slug?: string;
      };

      // super_admin can access any org's dashboard
      if (appMeta.role === 'super_admin') {
        setReady(true);
        return;
      }

      // Regular users: redirect to their own org if URL slug doesn't match
      const userSlug = appMeta.organization_slug;
      if (userSlug && userSlug !== params.slug) {
        router.replace(`/${userSlug}/`);
        return;
      }

      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        setReady(false);
        router.replace('/login');
        return;
      }

      const appMeta = session.user.app_metadata as {
        role?: string;
        organization_slug?: string;
      };

      // super_admin can access any org's dashboard
      if (appMeta.role === 'super_admin') {
        setReady(true);
        return;
      }

      // Regular users: redirect to their own org if URL slug doesn't match
      const userSlug = appMeta.organization_slug;
      if (userSlug && userSlug !== params.slug) {
        router.replace(`/${userSlug}/`);
        return;
      }

      setReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, params.slug]);

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

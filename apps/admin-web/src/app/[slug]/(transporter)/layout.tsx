'use client';

// Transporter pages are data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Truck, FilePlus2, LogOut } from 'lucide-react';
import { ProfileLocaleHydration } from '@/components/layout/ProfileLocaleHydration';
import { supabase } from '@/lib/supabase';
import { resolveOrganizationSlugForSession } from '@/lib/resolve-organization-slug';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-neutral-50">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="text-sm text-neutral-500">{t('auth.checkingSession')}</span>
    </div>
  );
}

/**
 * The transporter's minimal shell — deliberately NOT the admin dashboard.
 *
 * A `(transporter)` route group coexists with `(dashboard)` under `[slug]` (route
 * groups don't affect the URL), so this layout wraps ONLY the transporter pages
 * and shows a two-item nav with no admin Sidebar. It re-does the org-scoping the
 * dashboard layout does (that layout does not wrap this group) and additionally
 * gates on role: a non-transporter is bounced to the admin dashboard. The backend
 * `@Roles(transportator)` guard + RLS remain the real boundary.
 */
export default function TransporterLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const guard = async (
      session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'],
    ) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
        return;
      }
      if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
        queryClient.clear();
      }
      activeUserIdRef.current = session.user.id;

      const appMeta = session.user.app_metadata as { role?: string; organization_slug?: string };

      // Only transporters live here; anyone else goes to the admin dashboard.
      if (appMeta.role !== 'transportator') {
        router.replace(`/${params.slug}/`);
        return;
      }

      const userSlug =
        appMeta.organization_slug ?? (await resolveOrganizationSlugForSession(session));
      if (!userSlug) {
        router.replace('/login');
        return;
      }
      if (userSlug !== params.slug) {
        router.replace(`/${userSlug}/transport`);
        return;
      }
      setReady(true);
    };

    void supabase.auth.getSession().then(({ data: { session } }) => void guard(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        queryClient.clear();
        activeUserIdRef.current = null;
        setReady(false);
        router.replace('/login');
        return;
      }
      void guard(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, params.slug, queryClient]);

  if (!ready) return <LoadingScreen />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ProfileLocaleHydration />
      <TransporterHeader
        slug={params.slug}
        pathname={pathname}
        onSignOut={() => void supabase.auth.signOut()}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}

function TransporterHeader({
  slug,
  pathname,
  onSignOut,
}: {
  slug: string;
  pathname: string;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const items = [
    { href: `/${slug}/transport`, label: t('nav.transportTrips'), icon: Truck, exact: true },
    { href: `/${slug}/transport/new`, label: t('nav.transportNew'), icon: FilePlus2, exact: false },
  ];

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-neutral-200 bg-surface px-4 py-2.5 sm:px-6">
      <div className="flex items-center gap-2 font-semibold text-neutral-800">
        <Truck className="h-5 w-5 text-primary" />
        <span className="hidden sm:inline">{t('transporter.brand')}</span>
      </div>
      <nav className="flex flex-1 items-center gap-1">
        {items.map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800',
              )}
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={onSignOut}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        title={t('topBar.signOut')}
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">{t('topBar.signOut')}</span>
      </button>
    </header>
  );
}

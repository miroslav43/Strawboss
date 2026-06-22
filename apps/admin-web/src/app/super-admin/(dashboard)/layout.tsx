'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
        return;
      }
      if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
        queryClient.clear();
      }
      activeUserIdRef.current = session.user.id;
      const role = (session.user.app_metadata as { role?: string }).role;
      if (role !== 'super_admin') {
        router.replace('/login');
        return;
      }
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
      const role = (session.user.app_metadata as { role?: string }).role;
      if (role !== 'super_admin') {
        router.replace('/login');
        return;
      }
      setReady(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, queryClient]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    router.replace('/login');
  };

  if (!ready) return <div className="flex h-screen items-center justify-center" />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 bg-neutral-900 px-6 py-4 text-white">
        <span className="text-lg font-bold">{t('superAdmin.brand')}</span>
        <nav className="flex flex-1 gap-4 text-sm">
          <a href="/super-admin/organizations" className="hover:underline">
            {t('superAdmin.users.breadcrumb.orgs')}
          </a>
          <a href="/super-admin/devices" className="hover:underline">
            {t('superAdmin.devices.navLabel')}
          </a>
        </nav>
        <button
          onClick={handleLogout}
          className="rounded-md border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-400 hover:text-white"
        >
          {t('topBar.signOut')}
        </button>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

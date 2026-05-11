'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) { router.replace('/login'); return; }
      const role = (session.user.app_metadata as { role?: string }).role;
      if (role !== 'super_admin') { router.replace('/login'); return; }
      setReady(true);
    });
    return () => { active = false; };
  }, [router]);

  if (!ready) return <div className="flex h-screen items-center justify-center" />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 bg-neutral-900 px-6 py-4 text-white">
        <span className="text-lg font-bold">Super Admin</span>
        <nav className="flex gap-4 text-sm">
          <a href="/super-admin/organizations" className="hover:underline">Organizations</a>
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

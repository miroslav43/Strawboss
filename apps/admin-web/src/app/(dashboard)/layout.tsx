'use client';

// Dashboard pages are auth-gated and data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query-client';
import { RealtimeProvider } from '@/lib/realtime';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';

// Singleton for the browser; a fresh instance per server render (SSR-safe).
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();
  const queryClient = getQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login');
      } else {
        setAuthChecked(true);
      }
    });

    // Also listen for sign-out events.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/login');
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [router]);

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50">
        <div className="text-sm text-neutral-400">Se verifică sesiunea…</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <div className="flex h-screen">
          <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
            <main className="flex-1 overflow-y-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}

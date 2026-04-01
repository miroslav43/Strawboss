'use client';

// Dashboard pages are data-driven — never statically prerender.
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { RealtimeProvider } from '@/lib/realtime';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Prevent React Query hooks in page children from running during SSR/static
  // generation — they require a browser context. Set to true immediately on
  // first client render so there is no visible delay.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <RealtimeProvider>
      {!mounted ? (
        <div className="flex h-screen items-center justify-center bg-neutral-50" />
      ) : (
        <div className="flex h-screen">
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

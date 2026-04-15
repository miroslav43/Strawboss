'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Menu, Bell, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n';

const BREADCRUMB_SEGMENT_KEYS: Record<string, string> = {
  operations: 'breadcrumb.operations',
  tasks: 'breadcrumb.tasks',
  trips: 'breadcrumb.trips',
  documents: 'breadcrumb.documents',
  reports: 'breadcrumb.reports',
  alerts: 'breadcrumb.alerts',
  map: 'breadcrumb.map',
  farms: 'breadcrumb.farms',
  parcels: 'breadcrumb.parcels',
  machines: 'breadcrumb.machines',
  accounts: 'breadcrumb.accounts',
  settings: 'breadcrumb.settings',
  login: 'login.title',
};

function deriveBreadcrumb(pathname: string, t: (key: string) => string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return t('topBar.dashboard');
  return segments
    .map((s) => {
      const key = BREADCRUMB_SEGMENT_KEYS[s];
      if (key) return t(key);
      if (/^[0-9a-f-]{36}$/i.test(s)) return s;
      return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
    })
    .join(' / ');
}

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const breadcrumb = deriveBreadcrumb(pathname, t);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-surface px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 lg:hidden"
          aria-label={t('topBar.toggleMenu')}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium text-neutral-600">{breadcrumb}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="relative rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label={t('topBar.notifications')}
        >
          <Bell className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          aria-label={t('topBar.signOut')}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t('topBar.signOut')}</span>
        </button>
      </div>
    </header>
  );
}

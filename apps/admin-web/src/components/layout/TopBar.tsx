'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Menu, Bell, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function deriveBreadcrumb(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'Dashboard';
  return segments
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' '))
    .join(' / ');
}

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const breadcrumb = deriveBreadcrumb(pathname);

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
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium text-neutral-600">{breadcrumb}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="relative rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}

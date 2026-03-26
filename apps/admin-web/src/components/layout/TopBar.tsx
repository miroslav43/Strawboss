'use client';

import { usePathname } from 'next/navigation';
import { Menu, Bell, User } from 'lucide-react';

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
  const breadcrumb = deriveBreadcrumb(pathname);

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
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white"
          aria-label="User menu"
        >
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import {
  Activity,
  KanbanSquare,
  Truck,
  FileText,
  BarChart3,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SidebarLink } from './SidebarLink';

const navItems = [
  { href: '/operations', icon: Activity, label: 'Operations' },
  { href: '/tasks', icon: KanbanSquare, label: 'Tasks' },
  { href: '/trips', icon: Truck, label: 'Trips' },
  { href: '/documents', icon: FileText, label: 'Documents' },
  { href: '/reports', icon: BarChart3, label: 'Reports' },
  { href: '/alerts', icon: Bell, label: 'Alerts' },
] as const;

const bottomItems = [
  { href: '/settings', icon: Settings, label: 'Settings' },
] as const;

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-neutral-200 bg-surface transition-all duration-200',
        open ? 'w-60' : 'w-16',
      )}
    >
      {/* Header */}
      <div className={cn('flex h-14 items-center border-b border-neutral-200 px-3', open ? 'justify-between' : 'justify-center')}>
        {open && (
          <span className="text-lg font-bold text-primary">StrawBoss</span>
        )}
        <button
          onClick={onToggle}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {open ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
            expanded={open}
          />
        ))}
      </nav>

      {/* Separator + bottom nav */}
      <div className="border-t border-neutral-200 p-2">
        {bottomItems.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
            expanded={open}
          />
        ))}
      </div>
    </aside>
  );
}

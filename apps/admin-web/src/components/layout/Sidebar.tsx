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
  Map,
  Users,
  Wrench,
  Tractor,
  Wheat,
  Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SidebarLink } from './SidebarLink';

const navItems = [
  { href: '/operations', icon: Activity, labelKey: 'nav.operations' as const },
  { href: '/tasks', icon: KanbanSquare, labelKey: 'nav.tasks' as const },
  { href: '/trips', icon: Truck, labelKey: 'nav.trips' as const },
  { href: '/documents', icon: FileText, labelKey: 'nav.documents' as const },
  { href: '/reports', icon: BarChart3, labelKey: 'nav.reports' as const },
  { href: '/alerts', icon: Bell, labelKey: 'nav.alerts' as const },
  { href: '/map', icon: Map, labelKey: 'nav.map' as const },
  { href: '/farms', icon: Tractor, labelKey: 'nav.farms' as const },
  { href: '/parcels', icon: Wheat, labelKey: 'nav.parcels' as const },
  { href: '/deposits', icon: Warehouse, labelKey: 'nav.deposits' as const },
  { href: '/machines', icon: Wrench, labelKey: 'nav.machines' as const },
  { href: '/accounts', icon: Users, labelKey: 'nav.accounts' as const },
] as const;

const bottomItems = [{ href: '/settings', icon: Settings, labelKey: 'nav.settings' as const }] as const;

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();

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
          aria-label={open ? t('nav.collapseSidebar') : t('nav.expandSidebar')}
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
            label={t(item.labelKey)}
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
            label={t(item.labelKey)}
            active={pathname.startsWith(item.href)}
            expanded={open}
          />
        ))}
      </div>
    </aside>
  );
}

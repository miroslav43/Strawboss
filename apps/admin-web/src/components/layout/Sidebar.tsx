'use client';

import { usePathname } from 'next/navigation';
import { useOrgSlug } from '@/hooks/useOrgSlug';
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
  Fuel,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SidebarLink } from './SidebarLink';

function buildNavItems(slug: string) {
  return [
    { href: `/${slug}/operations`, icon: Activity, labelKey: 'nav.operations' as const },
    { href: `/${slug}/tasks`, icon: KanbanSquare, labelKey: 'nav.tasks' as const },
    { href: `/${slug}/trips`, icon: Truck, labelKey: 'nav.trips' as const },
    { href: `/${slug}/documents`, icon: FileText, labelKey: 'nav.documents' as const },
    { href: `/${slug}/reports`, icon: BarChart3, labelKey: 'nav.reports' as const },
    { href: `/${slug}/alerts`, icon: Bell, labelKey: 'nav.alerts' as const },
    { href: `/${slug}/map`, icon: Map, labelKey: 'nav.map' as const },
    { href: `/${slug}/farms`, icon: Tractor, labelKey: 'nav.farms' as const },
    { href: `/${slug}/parcels`, icon: Wheat, labelKey: 'nav.parcels' as const },
    { href: `/${slug}/deposits`, icon: Warehouse, labelKey: 'nav.deposits' as const },
    { href: `/${slug}/machines`, icon: Wrench, labelKey: 'nav.machines' as const },
    { href: `/${slug}/fuel-logs`, icon: Fuel, labelKey: 'nav.fuelLogs' as const },
    { href: `/${slug}/consumable-logs`, icon: Package, labelKey: 'nav.consumableLogs' as const },
    { href: `/${slug}/accounts`, icon: Users, labelKey: 'nav.accounts' as const },
  ] as const;
}

function buildBottomItems(slug: string) {
  return [
    { href: `/${slug}/settings`, icon: Settings, labelKey: 'nav.settings' as const },
  ] as const;
}

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const slug = useOrgSlug();
  const navItems = buildNavItems(slug);
  const bottomItems = buildBottomItems(slug);

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

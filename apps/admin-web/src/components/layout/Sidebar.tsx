'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import {
  KanbanSquare,
  Truck,
  FileText,
  BarChart3,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Map,
  FlagTriangleRight,
  Users,
  Wrench,
  Tractor,
  Wheat,
  Warehouse,
  Fuel,
  Package,
  MonitorDot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SidebarLink } from './SidebarLink';

function buildNavItems(slug: string) {
  return [
    { href: `/${slug}/command-center`, icon: MonitorDot, labelKey: 'nav.commandCenter' as const },
    { href: `/${slug}/tasks`, icon: KanbanSquare, labelKey: 'nav.tasks' as const },
    { href: `/${slug}/trips`, icon: Truck, labelKey: 'nav.trips' as const },
    { href: `/${slug}/documents`, icon: FileText, labelKey: 'nav.documents' as const },
    { href: `/${slug}/reports`, icon: BarChart3, labelKey: 'nav.reports' as const },
    { href: `/${slug}/alerts`, icon: Bell, labelKey: 'nav.alerts' as const },
    { href: `/${slug}/map`, icon: Map, labelKey: 'nav.map' as const },
    { href: `/${slug}/tracks`, icon: FlagTriangleRight, labelKey: 'nav.tracks' as const },
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

  // W19: close the mobile drawer whenever the user navigates to a new page.
  // Refs keep open/onToggle out of deps so the effect only fires on pathname
  // change — adding either to deps would close the drawer immediately after
  // the user opens it, since the parent passes a fresh onToggle on every
  // render.
  const openRef = useRef(open);
  const onToggleRef = useRef(onToggle);
  openRef.current = open;
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (openRef.current) {
      onToggleRef.current();
    }
  }, [pathname]);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-neutral-200 bg-surface transition-all duration-200',
        // ── Mobile (< sm): fixed drawer that slides in from the left ──
        'fixed inset-y-0 left-0 z-30 h-full w-60',
        open ? 'translate-x-0' : '-translate-x-full',
        // ── Desktop (sm+): static sidebar, no translate, width collapses ──
        'sm:relative sm:translate-x-0',
        open ? 'sm:w-60' : 'sm:w-16',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-neutral-200 px-3',
          open ? 'justify-between' : 'sm:justify-center',
        )}
      >
        {open && <span className="text-lg font-bold text-primary">StrawBoss</span>}
        <button
          onClick={onToggle}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label={open ? t('nav.collapseSidebar') : t('nav.expandSidebar')}
        >
          {open ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
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

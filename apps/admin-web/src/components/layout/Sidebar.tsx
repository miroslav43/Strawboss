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
  Building2,
  Mail,
} from 'lucide-react';
import type { FeatureKey } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useFeatures } from '@/hooks/useFeatures';
import { SidebarLink } from './SidebarLink';

/**
 * The one place all dashboard links are declared, and therefore the one place
 * feature-gated pages are hidden.
 *
 * `feature` is the key that governs the page. Items with none are CORE — the
 * command centre, the daily plan, trips, the map, machines and accounts cannot
 * be switched off, because an organization without them has no product left.
 * See the CORE section in `@strawboss/types` features.ts.
 *
 * Keys that are not wired yet are still listed: the API refuses to store an
 * override for them, so they simply never hide until their module lands.
 */
function buildNavItems(slug: string) {
  return [
    { href: `/${slug}/command-center`, icon: MonitorDot, labelKey: 'nav.commandCenter' as const },
    { href: `/${slug}/tasks`, icon: KanbanSquare, labelKey: 'nav.tasks' as const },
    // "Solicitări curse" is folded into Curse — it is the intake strip + the
    // "Curse Aux" ledger there. /trip-requests still resolves (it redirects), so
    // old bookmarks keep working. The page itself is CORE (own-fleet trips); the
    // aux ledger inside it is gated separately by the page.
    { href: `/${slug}/trips`, icon: Truck, labelKey: 'nav.trips' as const },
    {
      href: `/${slug}/beneficiaries`,
      icon: Building2,
      labelKey: 'nav.beneficiaries' as const,
      feature: 'portals.beneficiaries' as const,
    },
    {
      href: `/${slug}/messages`,
      icon: Mail,
      labelKey: 'nav.messages' as const,
      feature: 'messaging.monitor' as const,
    },
    {
      href: `/${slug}/documents`,
      icon: FileText,
      labelKey: 'nav.documents' as const,
      feature: 'documents.library' as const,
    },
    {
      href: `/${slug}/reports`,
      icon: BarChart3,
      labelKey: 'nav.reports' as const,
      feature: 'analytics.reports' as const,
    },
    {
      href: `/${slug}/alerts`,
      icon: Bell,
      labelKey: 'nav.alerts' as const,
      feature: 'analytics.alerts' as const,
    },
    { href: `/${slug}/map`, icon: Map, labelKey: 'nav.map' as const },
    {
      href: `/${slug}/tracks`,
      icon: FlagTriangleRight,
      labelKey: 'nav.tracks' as const,
      feature: 'geo.tracks' as const,
    },
    {
      href: `/${slug}/farms`,
      icon: Tractor,
      labelKey: 'nav.farms' as const,
      feature: 'geo.farms' as const,
    },
    {
      href: `/${slug}/parcels`,
      icon: Wheat,
      labelKey: 'nav.parcels' as const,
      feature: 'geo.parcels' as const,
    },
    {
      href: `/${slug}/deposits`,
      icon: Warehouse,
      labelKey: 'nav.deposits' as const,
      feature: 'depot.destinations' as const,
    },
    { href: `/${slug}/machines`, icon: Wrench, labelKey: 'nav.machines' as const },
    {
      href: `/${slug}/fuel-logs`,
      icon: Fuel,
      labelKey: 'nav.fuelLogs' as const,
      feature: 'costs.fuel' as const,
    },
    {
      href: `/${slug}/consumable-logs`,
      icon: Package,
      labelKey: 'nav.consumableLogs' as const,
      feature: 'costs.consumables' as const,
    },
    { href: `/${slug}/accounts`, icon: Users, labelKey: 'nav.accounts' as const },
  ] as const;
}

/** Route -> feature map, derived from the nav so the two can never disagree. */
export function navFeatureForPath(slug: string, pathname: string): FeatureKey | null {
  const match = buildNavItems(slug)
    .filter((item): item is typeof item & { feature: FeatureKey } => 'feature' in item)
    // Longest href first so `/trips/123` never matches a shorter sibling.
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.feature ?? null;
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
  const { isEnabled } = useFeatures();
  // Fail-open while the profile loads (see useFeatures), so the sidebar renders
  // complete on first paint instead of visibly filling in.
  const navItems = buildNavItems(slug).filter(
    (item) => !('feature' in item) || isEnabled(item.feature),
  );
  // Settings is never gated: it is the only route to a password change, and the
  // read-only "which modules do I have" card lives there.
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

'use client';

import { TripStatus, HarvestStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const statusStyles: Record<TripStatus, string> = {
  [TripStatus.planned]: 'bg-neutral-100 text-neutral-700',
  [TripStatus.loading]: 'bg-amber-100 text-amber-800',
  [TripStatus.loaded]: 'bg-amber-100 text-amber-800',
  [TripStatus.in_transit]: 'bg-blue-100 text-blue-800',
  [TripStatus.arrived]: 'bg-blue-100 text-blue-800',
  [TripStatus.delivering]: 'bg-green-100 text-green-800',
  [TripStatus.delivered]: 'bg-green-100 text-green-800',
  [TripStatus.completed]: 'bg-emerald-100 text-emerald-800',
  [TripStatus.cancelled]: 'bg-red-100 text-red-800',
  [TripStatus.disputed]: 'bg-red-100 text-red-800',
};

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        statusStyles[status],
        className,
      )}
    >
      {t(`trips.status.${status}`)}
    </span>
  );
}

/**
 * T9.10 — Harvest status badge with the full eight-stage ladder.
 * Keeps trip-status colors untouched (separate map below).
 */
const harvestStatusStyles: Record<HarvestStatus, string> = {
  [HarvestStatus.planned]: 'bg-neutral-100 text-neutral-700',
  [HarvestStatus.to_harvest]: 'bg-blue-100 text-blue-800',
  [HarvestStatus.harvesting]: 'bg-yellow-100 text-yellow-800',
  [HarvestStatus.partial_harvested]: 'bg-orange-100 text-orange-800',
  [HarvestStatus.harvested]: 'bg-green-100 text-green-800',
  [HarvestStatus.in_loading]: 'bg-purple-100 text-purple-800',
  [HarvestStatus.loaded]: 'bg-indigo-100 text-indigo-800',
  [HarvestStatus.completed]: 'bg-emerald-100 text-emerald-800',
};

interface HarvestStatusBadgeProps {
  status: HarvestStatus;
  className?: string;
}

export function HarvestStatusBadge({ status, className }: HarvestStatusBadgeProps) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        harvestStatusStyles[status],
        className,
      )}
    >
      {t(`parcels.harvest.${status}`)}
    </span>
  );
}

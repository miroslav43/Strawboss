'use client';

import { TripStatus } from '@strawboss/types';
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

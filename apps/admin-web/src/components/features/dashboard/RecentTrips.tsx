'use client';

import type { Trip } from '@strawboss/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface RecentTripsProps {
  trips: Trip[];
  className?: string;
}

export function RecentTrips({ trips, className }: RecentTripsProps) {
  const { t } = useI18n();
  const recent = trips.slice(0, 5);

  if (recent.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('dashboard.noRecentTrips')}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-800">{t('dashboard.recentTrips')}</h2>
      <div className="space-y-3">
        {recent.map((trip) => (
          <div
            key={trip.id}
            className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-neutral-800">{trip.tripNumber}</span>
              <StatusBadge status={trip.status} />
            </div>
            <span className="truncate text-xs text-neutral-500">
              {trip.destinationName ?? '--'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

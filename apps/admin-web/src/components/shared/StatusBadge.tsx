import { TripStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';

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

const statusLabels: Record<TripStatus, string> = {
  [TripStatus.planned]: 'Planned',
  [TripStatus.loading]: 'Loading',
  [TripStatus.loaded]: 'Loaded',
  [TripStatus.in_transit]: 'In Transit',
  [TripStatus.arrived]: 'Arrived',
  [TripStatus.delivering]: 'Delivering',
  [TripStatus.delivered]: 'Delivered',
  [TripStatus.completed]: 'Completed',
  [TripStatus.cancelled]: 'Cancelled',
  [TripStatus.disputed]: 'Disputed',
};

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        statusStyles[status],
        className,
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

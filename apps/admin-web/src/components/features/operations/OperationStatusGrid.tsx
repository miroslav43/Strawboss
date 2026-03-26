'use client';

import { Truck, ArrowRight } from 'lucide-react';
import type { Trip } from '@strawboss/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';

interface OperationStatusGridProps {
  trips: Trip[];
  className?: string;
}

export function OperationStatusGrid({ trips, className }: OperationStatusGridProps) {
  if (trips.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center', className)}>
        <Truck className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
        <p className="text-sm text-neutral-500">No active trips</p>
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {trips.map((trip) => (
        <div
          key={trip.id}
          className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-800">
              {trip.tripNumber}
            </span>
            <StatusBadge status={trip.status} />
          </div>

          {/* Truck / Driver */}
          <div className="mb-3 flex items-center gap-2 text-xs text-neutral-600">
            <Truck className="h-3.5 w-3.5 text-neutral-400" />
            <span>Truck: {trip.truckId.slice(0, 8)}</span>
          </div>

          {/* Route */}
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span className="truncate">
              Parcel {trip.sourceParcelId.slice(0, 8)}
            </span>
            <ArrowRight className="h-3 w-3 flex-shrink-0 text-neutral-400" />
            <span className="truncate">
              {trip.destinationName ?? 'TBD'}
            </span>
          </div>

          {/* Bales + Progress */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-neutral-500">
              {trip.baleCount} bales
            </span>
            {trip.netWeightKg != null && (
              <span className="text-neutral-500">
                {(trip.netWeightKg / 1000).toFixed(1)} t
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-2">
            <TripProgressBar status={trip.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

const statusProgress: Record<string, number> = {
  planned: 5,
  loading: 15,
  loaded: 30,
  in_transit: 50,
  arrived: 65,
  delivering: 80,
  delivered: 90,
  completed: 100,
  cancelled: 0,
  disputed: 0,
};

function TripProgressBar({ status }: { status: string }) {
  const percent = statusProgress[status] ?? 0;

  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-100">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          percent === 100 ? 'bg-green-500' : 'bg-blue-500',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

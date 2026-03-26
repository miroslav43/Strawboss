import { Check } from 'lucide-react';
import { TripStatus } from '@strawboss/types';
import { cn } from '@/lib/utils';

const TRIP_STEPS: TripStatus[] = [
  TripStatus.planned,
  TripStatus.loading,
  TripStatus.loaded,
  TripStatus.in_transit,
  TripStatus.arrived,
  TripStatus.delivering,
  TripStatus.delivered,
  TripStatus.completed,
];

const stepLabels: Record<TripStatus, string> = {
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

interface TripTimelineProps {
  currentStatus: TripStatus;
  className?: string;
}

export function TripTimeline({ currentStatus, className }: TripTimelineProps) {
  if (
    currentStatus === TripStatus.cancelled ||
    currentStatus === TripStatus.disputed
  ) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="rounded-full bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700">
          {stepLabels[currentStatus]}
        </div>
      </div>
    );
  }

  const currentIndex = TRIP_STEPS.indexOf(currentStatus);

  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="flex items-center gap-0 min-w-max">
        {TRIP_STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;

          return (
            <div key={step} className="flex items-center">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                    isCompleted &&
                      'bg-green-600 text-white',
                    isCurrent &&
                      'bg-blue-600 text-white ring-2 ring-blue-200',
                    isFuture &&
                      'bg-neutral-100 text-neutral-400',
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={cn(
                    'mt-1.5 text-[10px] leading-tight',
                    isCompleted && 'font-medium text-green-700',
                    isCurrent && 'font-medium text-blue-700',
                    isFuture && 'text-neutral-400',
                  )}
                >
                  {stepLabels[step]}
                </span>
              </div>

              {/* Connector line */}
              {index < TRIP_STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-1 h-0.5 w-8',
                    index < currentIndex
                      ? 'bg-green-600'
                      : 'bg-neutral-200',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

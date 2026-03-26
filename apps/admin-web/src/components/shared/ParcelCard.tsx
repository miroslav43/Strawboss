import { MapPin } from 'lucide-react';
import type { Parcel } from '@strawboss/types';
import { cn } from '@/lib/utils';

interface ParcelCardProps {
  parcel: Parcel;
  className?: string;
}

export function ParcelCard({ parcel, className }: ParcelCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-200 bg-white p-4 shadow-sm',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
          <MapPin className="h-4 w-4 text-green-700" />
        </div>
        <div>
          <p className="text-sm font-semibold text-neutral-800">
            {parcel.name}
          </p>
          <p className="text-xs text-neutral-500">{parcel.code}</p>
        </div>
      </div>
      <div className="space-y-1 text-xs text-neutral-600">
        <p>
          <span className="text-neutral-400">Owner:</span> {parcel.ownerName}
        </p>
        <p>
          <span className="text-neutral-400">Area:</span>{' '}
          {parcel.areaHectares} ha
        </p>
      </div>
    </div>
  );
}

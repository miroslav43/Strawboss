import { Truck, Loader, CircleDot } from 'lucide-react';
import type { Machine, MachineType } from '@strawboss/types';
import { cn } from '@/lib/utils';

const machineIcons: Record<MachineType, typeof Truck> = {
  truck: Truck,
  loader: Loader,
  baler: CircleDot,
};

const machineTypeLabels: Record<MachineType, string> = {
  truck: 'Truck',
  loader: 'Loader',
  baler: 'Baler',
};

interface MachineCardProps {
  machine: Machine;
  className?: string;
  compact?: boolean;
}

export function MachineCard({ machine, className, compact }: MachineCardProps) {
  const Icon = machineIcons[machine.machineType] ?? Truck;

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm',
          className,
        )}
      >
        <Icon className="h-4 w-4 text-neutral-500" />
        <span className="text-sm font-medium text-neutral-800">
          {machine.internalCode}
        </span>
        <span className="text-xs text-neutral-400">
          {machine.registrationPlate}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-200 bg-white p-4 shadow-sm',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-neutral-800">
            {machine.internalCode}
          </p>
          <p className="text-xs text-neutral-500">
            {machineTypeLabels[machine.machineType]}
          </p>
        </div>
      </div>
      <div className="space-y-1 text-xs text-neutral-600">
        <p>
          <span className="text-neutral-400">Plate:</span>{' '}
          {machine.registrationPlate}
        </p>
        <p>
          <span className="text-neutral-400">Make/Model:</span>{' '}
          {machine.make} {machine.model}
        </p>
      </div>
    </div>
  );
}

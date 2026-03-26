'use client';

import { useDraggable } from '@dnd-kit/react';
import { Truck, Loader, CircleDot, GripVertical } from 'lucide-react';
import type { Machine, MachineType } from '@strawboss/types';
import { cn } from '@/lib/utils';

const machineIcons: Record<MachineType, typeof Truck> = {
  truck: Truck,
  loader: Loader,
  baler: CircleDot,
};

interface DraggableMachineCardProps {
  machine: Machine;
  columnId: string;
}

export function DraggableMachineCard({
  machine,
  columnId,
}: DraggableMachineCardProps) {
  const { ref, isDragging } = useDraggable({
    id: machine.id,
    data: { machine, columnId },
  });

  const Icon = machineIcons[machine.machineType] ?? Truck;

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm',
        'cursor-grab active:cursor-grabbing',
        'transition-all hover:border-neutral-300 hover:shadow-md',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-primary/20',
      )}
    >
      <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-neutral-300" />
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
        <Icon className="h-3.5 w-3.5 text-neutral-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-800">
          {machine.internalCode}
        </p>
        <p className="truncate text-[11px] text-neutral-500">
          {machine.registrationPlate}
        </p>
      </div>
    </div>
  );
}

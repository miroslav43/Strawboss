'use client';

import { useDraggable } from '@dnd-kit/react';
import { Truck, Container, CircleDot, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlanMachine {
  id: string;
  machineType: string;
  internalCode: string;
  registrationPlate: string;
}

const machineIcons: Record<string, typeof Truck> = {
  truck: Truck,
  loader: Container,
  baler: CircleDot,
};

const machineAccentColors: Record<string, string> = {
  baler: 'border-l-amber-400',
  loader: 'border-l-blue-400',
  truck: 'border-l-green-500',
};

const machineIconBg: Record<string, string> = {
  baler: 'bg-amber-50 text-amber-600',
  loader: 'bg-blue-50 text-blue-600',
  truck: 'bg-green-50 text-green-600',
};

interface DraggablePlanCardProps {
  machine: PlanMachine;
  assignmentId?: string | null;
  columnId: string;
  compact?: boolean;
}

export function DraggablePlanCard({
  machine,
  assignmentId,
  columnId,
  compact = false,
}: DraggablePlanCardProps) {
  const { ref, isDragging } = useDraggable({
    id: assignmentId ?? `machine-${machine.id}`,
    data: { machine, assignmentId, columnId },
  });

  const Icon = machineIcons[machine.machineType] ?? Truck;
  const accentColor = machineAccentColors[machine.machineType] ?? 'border-l-neutral-300';
  const iconBg = machineIconBg[machine.machineType] ?? 'bg-neutral-100 text-neutral-600';

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-neutral-200 border-l-[3px] bg-white shadow-sm',
        accentColor,
        'cursor-grab active:cursor-grabbing',
        'transition-all hover:border-neutral-300 hover:shadow-md',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-primary/20',
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5',
      )}
    >
      <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-neutral-300" />
      <div className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-full',
        iconBg,
        compact ? 'h-6 w-6' : 'h-7 w-7',
      )}>
        <Icon className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(
          'truncate font-medium text-neutral-800',
          compact ? 'text-xs' : 'text-sm',
        )}>
          {machine.internalCode}
        </p>
        {!compact && (
          <p className="truncate text-[11px] text-neutral-500">
            {machine.registrationPlate}
          </p>
        )}
      </div>
    </div>
  );
}

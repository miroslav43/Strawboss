'use client';

import { useDroppable } from '@dnd-kit/react';
import type { Machine } from '@strawboss/types';
import { DraggableMachineCard } from './DraggableMachineCard';
import { cn } from '@/lib/utils';

interface TaskBoardColumnProps {
  id: string;
  title: string;
  machines: Machine[];
}

export function TaskBoardColumn({ id, title, machines }: TaskBoardColumnProps) {
  const { ref, isDropTarget } = useDroppable({ id });

  return (
    <div
      className={cn(
        'flex w-64 flex-shrink-0 flex-col rounded-lg border bg-neutral-50',
        isDropTarget
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-neutral-200',
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-neutral-700">{title}</h3>
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
          {machines.length}
        </span>
      </div>

      {/* Card list */}
      <div ref={ref} className="flex-1 space-y-2 p-2" style={{ minHeight: 80 }}>
        {machines.map((machine) => (
          <DraggableMachineCard
            key={machine.id}
            machine={machine}
            columnId={id}
          />
        ))}
        {machines.length === 0 && (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
            Drop machines here
          </div>
        )}
      </div>
    </div>
  );
}

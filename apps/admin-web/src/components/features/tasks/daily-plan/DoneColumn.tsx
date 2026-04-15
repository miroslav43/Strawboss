'use client';

import { useDroppable } from '@dnd-kit/react';
import { CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DraggablePlanCard, type PlanMachine } from './DraggablePlanCard';

interface DoneAssignment {
  id: string;
  machine: PlanMachine;
}

interface DoneColumnProps {
  assignments: DoneAssignment[];
}

export function DoneColumn({ assignments }: DoneColumnProps) {
  const { t } = useI18n();
  const { ref, isDropTarget } = useDroppable({ id: 'done' });

  return (
    <div
      className={cn(
        'flex w-72 flex-shrink-0 flex-col rounded-lg border bg-neutral-50',
        isDropTarget
          ? 'border-green-400/40 bg-green-50/50 ring-1 ring-green-200'
          : 'border-neutral-200',
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          {t('tasks.done')}
        </h3>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-600">
          {assignments.length}
        </span>
      </div>

      {/* Done cards */}
      <div ref={ref} className="flex-1 space-y-1.5 overflow-y-auto p-2" style={{ minHeight: 80 }}>
        {assignments.length === 0 && (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
            {t('tasks.dropMachinesHere')}
          </div>
        )}

        {assignments.map((a) => (
          <div key={a.id} className="opacity-60">
            <DraggablePlanCard
              machine={a.machine}
              assignmentId={a.id}
              columnId="done"
              compact
            />
          </div>
        ))}
      </div>
    </div>
  );
}

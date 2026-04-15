'use client';

import { useDroppable } from '@dnd-kit/react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ParcelGroup, type HierarchicalAssignment } from './ParcelGroup';

export interface ParcelGroupData {
  parcelId: string;
  parcelName: string;
  parcelCode: string;
  isDone: boolean;
  assignments: HierarchicalAssignment[];
}

interface InProgressColumnProps {
  groups: ParcelGroupData[];
  onToggleParcelDone: (parcelId: string, isDone: boolean) => void;
  onRemoveEmptyParcelFromPlan?: (parcelId: string) => void;
}

export function InProgressColumn({
  groups,
  onToggleParcelDone,
  onRemoveEmptyParcelFromPlan,
}: InProgressColumnProps) {
  const { t } = useI18n();
  const { ref, isDropTarget } = useDroppable({ id: 'in_progress' });

  const totalMachines = groups.reduce(
    (sum, g) => sum + countAll(g.assignments),
    0,
  );

  return (
    <div
      className={cn(
        'flex min-w-[320px] flex-1 flex-col rounded-lg border bg-neutral-50',
        isDropTarget
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-neutral-200',
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-neutral-700">{t('tasks.inProgress')}</h3>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          {totalMachines}
        </span>
      </div>

      {/* Parcel groups */}
      <div ref={ref} className="flex-1 space-y-3 overflow-y-auto p-3" style={{ minHeight: 120 }}>
        {groups.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
            {t('tasks.dropMachinesHere')}
          </div>
        )}

        {groups.map((group) => (
          <ParcelGroup
            key={group.parcelId}
            parcelId={group.parcelId}
            parcelName={group.parcelName}
            parcelCode={group.parcelCode}
            isDone={group.isDone}
            assignments={group.assignments}
            onToggleDone={onToggleParcelDone}
            onRemoveEmptyFromPlan={onRemoveEmptyParcelFromPlan}
          />
        ))}
      </div>
    </div>
  );
}

function countAll(assignments: HierarchicalAssignment[]): number {
  let count = 0;
  for (const a of assignments) {
    count += 1 + countAll(a.children);
  }
  return count;
}

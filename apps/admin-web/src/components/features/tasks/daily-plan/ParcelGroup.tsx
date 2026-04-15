'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckSquare, Square, MapPin, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DraggablePlanCard, type PlanMachine } from './DraggablePlanCard';

export interface HierarchicalAssignment {
  id: string;
  machineId: string;
  machineType: string;
  machineCode: string;
  registrationPlate: string;
  parcelId: string | null;
  parentAssignmentId: string | null;
  children: HierarchicalAssignment[];
}

interface ParcelGroupProps {
  parcelId: string;
  parcelName: string;
  parcelCode: string;
  isDone: boolean;
  assignments: HierarchicalAssignment[];
  onToggleDone: (parcelId: string, isDone: boolean) => void;
  /** When there are no machines, remove parcel-day shell (parcel_daily_status row). */
  onRemoveEmptyFromPlan?: (parcelId: string) => void;
}

function AssignmentNode({
  assignment,
  depth,
}: {
  assignment: HierarchicalAssignment;
  depth: number;
}) {
  const machine: PlanMachine = {
    id: assignment.machineId,
    machineType: assignment.machineType,
    internalCode: assignment.machineCode,
    registrationPlate: assignment.registrationPlate,
  };

  return (
    <div>
      <div className="flex items-stretch">
        {/* Indent + connecting line */}
        {depth > 0 && (
          <div className="flex items-center" style={{ width: depth * 20 }}>
            {Array.from({ length: depth }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-full w-5 flex-shrink-0',
                  i < depth - 1 ? 'border-l border-neutral-200' : '',
                )}
              />
            ))}
          </div>
        )}
        {depth > 0 && (
          <div className="flex items-center">
            <div className="h-px w-3 bg-neutral-200" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <DraggablePlanCard
            machine={machine}
            assignmentId={assignment.id}
            columnId="in_progress"
            compact={depth > 0}
          />
        </div>
      </div>

      {/* Children */}
      {assignment.children.map((child) => (
        <AssignmentNode key={child.id} assignment={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ParcelGroup({
  parcelId,
  parcelName,
  parcelCode,
  isDone,
  assignments,
  onToggleDone,
  onRemoveEmptyFromPlan,
}: ParcelGroupProps) {
  const { t } = useI18n();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const totalMachines = countAssignments(assignments);
  const isEmpty = totalMachines === 0;

  return (
    <div className={cn(
      'rounded-lg border bg-white',
      isDone ? 'border-green-200 bg-green-50/50' : 'border-neutral-200',
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-neutral-400 hover:text-neutral-600"
        >
          {isCollapsed
            ? <ChevronRight className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />
          }
        </button>

        <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />

        <div className="min-w-0 flex-1">
          <span className={cn(
            'text-sm font-semibold',
            isDone ? 'text-green-700 line-through' : 'text-neutral-700',
          )}>
            {parcelName || parcelCode}
          </span>
          {parcelName && parcelCode && (
            <span className="ml-1.5 text-xs text-neutral-400">{parcelCode}</span>
          )}
        </div>

        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
          {totalMachines}
        </span>

        {isEmpty && onRemoveEmptyFromPlan && (
          <button
            type="button"
            onClick={() => onRemoveEmptyFromPlan(parcelId)}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title={t('tasks.removeEmptyParcelFromPlan')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        {/* Done toggle */}
        <button
          onClick={() => onToggleDone(parcelId, !isDone)}
          className={cn(
            'rounded p-1 transition-colors',
            isDone
              ? 'text-green-600 hover:text-green-700'
              : 'text-neutral-300 hover:text-neutral-500',
          )}
          title={isDone ? t('tasks.parcelDone') : t('tasks.markParcelDone')}
        >
          {isDone ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </button>
      </div>

      {/* Assignment tree */}
      {!isCollapsed && (
        <div className="space-y-1 border-t border-neutral-100 p-2">
          {assignments.length === 0 ? (
            <p className="py-2 text-center text-xs text-neutral-400">
              {t('tasks.noMachinesAssigned')}
            </p>
          ) : (
            assignments.map((a) => (
              <AssignmentNode key={a.id} assignment={a} depth={0} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function countAssignments(assignments: HierarchicalAssignment[]): number {
  let count = 0;
  for (const a of assignments) {
    count += 1 + countAssignments(a.children);
  }
  return count;
}

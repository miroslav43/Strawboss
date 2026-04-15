'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import {
  useDailyPlan,
  useParcels,
  useCreateTaskAssignment,
  useUpdateAssignmentStatus,
  useAutoCompleteAssignments,
  useUpsertParcelDailyStatus,
  useDeleteParcelDailyStatusForDate,
  useDeleteTaskAssignment,
} from '@strawboss/api';
import type { Parcel } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { normalizeList } from '@/lib/normalize-api-list';
import { useI18n } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';

import { AvailableColumn } from './AvailableColumn';
import { InProgressColumn, type ParcelGroupData } from './InProgressColumn';
import { DoneColumn } from './DoneColumn';
import { AssignmentModal } from './AssignmentModal';
import type { PlanMachine } from './DraggablePlanCard';
import type { HierarchicalAssignment } from './ParcelGroup';

interface DailyPlanBoardProps {
  date: string;
}

export function DailyPlanBoard({ date }: DailyPlanBoardProps) {
  const { t } = useI18n();
  const dailyPlanQuery = useDailyPlan(apiClient, date);
  const parcelsQuery = useParcels(apiClient);
  const createAssignment = useCreateTaskAssignment(apiClient);
  const updateStatus = useUpdateAssignmentStatus(apiClient);
  const deleteAssignment = useDeleteTaskAssignment(apiClient);
  const autoComplete = useAutoCompleteAssignments(apiClient);
  const upsertParcelStatus = useUpsertParcelDailyStatus(apiClient);
  const deleteParcelDayStatus = useDeleteParcelDailyStatusForDate(apiClient);

  // Modal state
  const [modalMachine, setModalMachine] = useState<PlanMachine | null>(null);

  // Auto-complete past assignments (run once per date)
  const autoCompleteRef = useRef<string | null>(null);
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (date === today && autoCompleteRef.current !== today) {
      autoCompleteRef.current = today;
      autoComplete.mutate(today);
    }
  }, [date, autoComplete]);

  // Parse data
  const plan = dailyPlanQuery.data as Record<string, unknown> | undefined;
  const allParcels = useMemo(
    () => normalizeList<Parcel>(parcelsQuery.data),
    [parcelsQuery.data],
  );

  // Available machines
  const availableMachines: PlanMachine[] = useMemo(() => {
    const raw = (plan?.available as Array<Record<string, unknown>>) ?? [];
    return raw.map((item) => {
      const m = item.machine as Record<string, unknown>;
      return {
        id: m.id as string,
        machineType: m.machineType as string,
        internalCode: m.internalCode as string,
        registrationPlate: m.registrationPlate as string,
      };
    });
  }, [plan]);

  // In-progress groups
  const inProgressGroups: ParcelGroupData[] = useMemo(() => {
    const raw = (plan?.inProgress as Array<Record<string, unknown>>) ?? [];
    return raw.map((group) => ({
      parcelId: group.parcelId as string,
      parcelName: group.parcelName as string,
      parcelCode: group.parcelCode as string,
      isDone: group.isDone as boolean,
      assignments: parseAssignments(
        (group.assignments as Array<Record<string, unknown>>) ?? [],
      ),
    }));
  }, [plan]);

  // Done assignments
  const doneAssignments = useMemo(() => {
    const raw = (plan?.done as Array<Record<string, unknown>>) ?? [];
    return raw.map((item) => {
      const m = (item.machine ?? item) as Record<string, unknown>;
      return {
        id: (item.id ?? item.assignmentId) as string,
        machine: {
          id: (m.id ?? item.machineId) as string,
          machineType: (m.machineType ?? item.machineType) as string,
          internalCode: (m.internalCode ?? m.machineCode ?? item.machineCode) as string,
          registrationPlate: (m.registrationPlate ?? item.registrationPlate) as string,
        },
      };
    });
  }, [plan]);

  // Done parcels set
  const doneParcels = useMemo(() => {
    const statuses = (plan?.parcelStatuses as Array<Record<string, unknown>>) ?? [];
    const set = new Set<string>();
    for (const s of statuses) {
      if (s.isDone) set.add(s.parcelId as string);
    }
    return set;
  }, [plan]);

  // Flatten in-progress assignments for the modal's parent selection
  const flatInProgress = useMemo(() => {
    const result: Array<{
      id: string;
      machineId: string;
      machineType: string;
      machineCode: string;
      parcelId: string | null;
      parcelName: string | null;
      parentAssignmentId: string | null;
    }> = [];

    function flatten(assignments: HierarchicalAssignment[], parcelId: string | null, parcelName: string | null) {
      for (const a of assignments) {
        result.push({
          id: a.id,
          machineId: a.machineId,
          machineType: a.machineType,
          machineCode: a.machineCode,
          parcelId: a.parcelId ?? parcelId,
          parcelName: parcelName,
          parentAssignmentId: a.parentAssignmentId,
        });
        flatten(a.children, a.parcelId ?? parcelId, parcelName);
      }
    }

    for (const group of inProgressGroups) {
      flatten(group.assignments, group.parcelId, group.parcelName);
    }
    return result;
  }, [inProgressGroups]);

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: {
      operation: {
        source: { id: unknown; data?: Record<string, unknown> } | null;
        target: { id: unknown } | null;
      };
      canceled: boolean;
    }) => {
      const { source, target } = event.operation;
      if (!source || !target || event.canceled) return;

      const sourceData = source.data ?? {};
      const machine = sourceData.machine as PlanMachine | undefined;
      const sourceColumn = sourceData.columnId as string;
      const assignmentId = sourceData.assignmentId as string | undefined;
      const targetColumn = String(target.id);

      if (sourceColumn === targetColumn || !machine) return;

      // Moving to in_progress: open modal for assignment
      if (targetColumn === 'in_progress') {
        setModalMachine(machine);
        return;
      }

      // Moving to done
      if (targetColumn === 'done' && assignmentId) {
        clientLogger.flow('Daily plan: assignment moved to done column', {
          board: 'daily-plan',
          planDate: date,
          assignmentId,
        });
        updateStatus.mutate({ id: assignmentId, status: 'done' });
        return;
      }

      // Moving back to available
      if (targetColumn === 'available' && assignmentId) {
        clientLogger.flow('Daily plan: assignment moved back to available', {
          board: 'daily-plan',
          planDate: date,
          assignmentId,
        });
        // Delete the assignment to move back to available
        deleteAssignment.mutate(assignmentId);
        return;
      }
    },
    [date, updateStatus, deleteAssignment],
  );

  // Handle assignment from modal
  const handleAssign = useCallback(
    (data: {
      machineId: string;
      parcelId: string | null;
      parentAssignmentId: string | null;
    }) => {
      clientLogger.flow('Daily plan: create assignment from modal', {
        board: 'daily-plan',
        planDate: date,
        machineId: data.machineId,
        parcelId: data.parcelId,
        parentAssignmentId: data.parentAssignmentId,
      });
      createAssignment.mutate({
        assignmentDate: date,
        machineId: data.machineId,
        parcelId: data.parcelId,
        status: 'in_progress' as unknown as undefined,
        parentAssignmentId: data.parentAssignmentId,
        sequenceOrder: 0,
      } as Partial<import('@strawboss/types').TaskAssignment>);
      setModalMachine(null);
    },
    [date, createAssignment],
  );

  // Handle parcel done toggle
  const handleToggleParcelDone = useCallback(
    (parcelId: string, isDone: boolean) => {
      upsertParcelStatus.mutate({ parcelId, statusDate: date, isDone });
    },
    [date, upsertParcelStatus],
  );

  const handleRemoveEmptyParcelFromPlan = useCallback(
    (parcelId: string) => {
      deleteParcelDayStatus.mutate({ parcelId, statusDate: date });
    },
    [date, deleteParcelDayStatus],
  );

  // Loading / error states
  const isLoading = dailyPlanQuery.isLoading || parcelsQuery.isLoading;
  const isError = dailyPlanQuery.isError || parcelsQuery.isError;

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-400">
        {t('common.loading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center text-sm text-red-500">
        {t('tasks.loadError')}
      </div>
    );
  }

  return (
    <>
      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
          <AvailableColumn machines={availableMachines} />
          <InProgressColumn
            groups={inProgressGroups}
            onToggleParcelDone={handleToggleParcelDone}
            onRemoveEmptyParcelFromPlan={handleRemoveEmptyParcelFromPlan}
          />
          <DoneColumn assignments={doneAssignments} />
        </div>
      </DragDropProvider>

      {/* Assignment modal */}
      {modalMachine && (
        <AssignmentModal
          machine={modalMachine}
          date={date}
          parcels={allParcels}
          doneParcels={doneParcels}
          inProgressAssignments={flatInProgress}
          onAssign={handleAssign}
          onClose={() => setModalMachine(null)}
        />
      )}
    </>
  );
}

function parseAssignments(
  raw: Array<Record<string, unknown>>,
): HierarchicalAssignment[] {
  return raw.map((item) => ({
    id: item.id as string,
    machineId: item.machineId as string,
    machineType: item.machineType as string,
    machineCode: (item.machineCode ?? item.internalCode) as string,
    registrationPlate: item.registrationPlate as string,
    parcelId: (item.parcelId as string) ?? null,
    parentAssignmentId: (item.parentAssignmentId as string) ?? null,
    children: parseAssignments(
      (item.children as Array<Record<string, unknown>>) ?? [],
    ),
  }));
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import {
  useTaskAssignments,
  useParcels,
  useMachines,
  useAssignMachineToParcel,
} from '@strawboss/api';
import type { Machine, Parcel, TaskAssignment, PaginatedResponse } from '@strawboss/types';
import { TaskBoardColumn } from './TaskBoardColumn';
import { apiClient } from '@/lib/api';

interface TaskBoardProps {
  date: string;
}

export function TaskBoard({ date }: TaskBoardProps) {
  const assignmentsQuery = useTaskAssignments(apiClient, date);
  const parcelsQuery = useParcels(apiClient);
  const machinesQuery = useMachines(apiClient);
  const assignMutation = useAssignMachineToParcel(apiClient);

  const assignments: TaskAssignment[] = assignmentsQuery.data ?? [];
  const parcelsResponse = parcelsQuery.data as PaginatedResponse<Parcel> | undefined;
  const parcels = parcelsResponse?.data ?? [];
  const machinesResponse = machinesQuery.data as PaginatedResponse<Machine> | undefined;
  const allMachines = machinesResponse?.data ?? [];

  // Track local optimistic assignments: machineId -> parcelId | null
  const [localAssignments, setLocalAssignments] = useState<
    Record<string, string | null>
  >({});

  // Build machine-to-parcel mapping from server + local overrides
  const machineParcelMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const a of assignments) {
      map[a.machineId] = a.parcelId;
    }
    // Apply local overrides
    for (const [machineId, parcelId] of Object.entries(localAssignments)) {
      map[machineId] = parcelId;
    }
    return map;
  }, [assignments, localAssignments]);

  // Split machines into columns
  const unassignedMachines = allMachines.filter(
    (m) => !machineParcelMap[m.id],
  );

  const assignedByParcel = useMemo(() => {
    const result: Record<string, Machine[]> = {};
    for (const parcel of parcels) {
      result[parcel.id] = allMachines.filter(
        (m) => machineParcelMap[m.id] === parcel.id,
      );
    }
    return result;
  }, [parcels, allMachines, machineParcelMap]);

  const handleDragEnd = useCallback(
    (event: { operation: { source: { id: unknown; data?: Record<string, unknown> } | null; target: { id: unknown } | null }; canceled: boolean }) => {
      const { source, target } = event.operation;
      if (!source || !target || event.canceled) return;

      const machineId = String(source.id);
      const targetParcelId = String(target.id);

      // If dropped back on same column, ignore
      const sourceColumnId = source.data?.columnId as string | undefined;
      if (sourceColumnId === targetParcelId) return;

      const newParcelId = targetParcelId === 'unassigned' ? null : targetParcelId;

      // Optimistic local update
      setLocalAssignments((prev) => ({ ...prev, [machineId]: newParcelId }));

      // Call mutation if assigning to a parcel
      if (newParcelId) {
        assignMutation.mutate(
          {
            machineId,
            parcelId: newParcelId,
            assignmentDate: date,
            sequenceOrder: (assignedByParcel[newParcelId]?.length ?? 0) + 1,
          },
          {
            onSettled: () => {
              // Clear local override after server responds
              setLocalAssignments((prev) => {
                const next = { ...prev };
                delete next[machineId];
                return next;
              });
            },
          },
        );
      }
    },
    [date, assignMutation, assignedByParcel],
  );

  const isLoading =
    assignmentsQuery.isLoading ||
    parcelsQuery.isLoading ||
    machinesQuery.isLoading;
  const isError =
    assignmentsQuery.isError || parcelsQuery.isError || machinesQuery.isError;

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        Loading task board...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-red-500">
        Failed to load data. The backend may not be running.
      </div>
    );
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        <TaskBoardColumn
          id="unassigned"
          title="Unassigned"
          machines={unassignedMachines}
        />
        {parcels.map((parcel) => (
          <TaskBoardColumn
            key={parcel.id}
            id={parcel.id}
            title={parcel.name}
            machines={assignedByParcel[parcel.id] ?? []}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { Plus, Loader2, X, MapPin } from 'lucide-react';
import {
  useTasksByMachineType,
  useCreateTaskAssignment,
  useDeleteTaskAssignment,
  useUpdateTaskAssignment,
  useDeliveryDestinations,
  useMachines,
} from '@strawboss/api';
import type { Machine, DeliveryDestination } from '@strawboss/types';
import { AssignmentStatus } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clientLogger } from '@/lib/client-logger';
import { cn } from '@/lib/utils';
import { normalizeList as normalize } from '@/lib/normalize-api-list';
import { DepositMapModal } from './DepositMapModal';
import { LoaderPickMapModal } from './LoaderPickMapModal';

interface Assignment {
  id: string;
  machineId: string;
  machineCode: string;
  machineType: string;
  registrationPlate: string;
  parentAssignmentId: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationCode: string | null;
  status: string;
}

// ─── TruckPlanBoard ──────────────────────────────────────────────────────────

interface TruckPlanBoardProps {
  date: string;
}

export function TruckPlanBoard({ date }: TruckPlanBoardProps) {
  const { t } = useI18n();
  const [loaderMapForTruckAssignmentId, setLoaderMapForTruckAssignmentId] = useState<string | null>(
    null,
  );
  const [depositMapForTruckAssignmentId, setDepositMapForTruckAssignmentId] = useState<string | null>(
    null,
  );
  const { data: rawAssignments, isLoading } = useTasksByMachineType(apiClient, date, 'truck');
  const { data: rawLoaderAssignments } = useTasksByMachineType(apiClient, date, 'loader');
  const { data: rawMachines } = useMachines(apiClient);
  const { data: rawDeposits } = useDeliveryDestinations(apiClient);

  const createAssignment = useCreateTaskAssignment(apiClient);
  const deleteAssignment = useDeleteTaskAssignment(apiClient);
  const updateAssignment = useUpdateTaskAssignment(apiClient);

  const assignments = useMemo(() => normalize<Assignment>(rawAssignments), [rawAssignments]);
  const loaderAssignments = useMemo(() => normalize<Assignment>(rawLoaderAssignments), [rawLoaderAssignments]);
  const machines = useMemo(() => normalize<Machine>(rawMachines), [rawMachines]);
  const deposits = useMemo(() => normalize<DeliveryDestination>(rawDeposits), [rawDeposits]);

  const trucks = useMemo(
    () => machines.filter((m) => m.machineType === 'truck' && m.isActive),
    [machines],
  );

  const assignedTruckIds = useMemo(
    () => new Set(assignments.map((a) => a.machineId)),
    [assignments],
  );

  const availableTrucks = useMemo(
    () => trucks.filter((m) => !assignedTruckIds.has(m.id)),
    [trucks, assignedTruckIds],
  );

  // Unique loader assignments (one per loader)
  const uniqueLoaders = useMemo(() => {
    const seen = new Set<string>();
    return loaderAssignments.filter((a) => {
      if (seen.has(a.machineId)) return false;
      seen.add(a.machineId);
      return true;
    });
  }, [loaderAssignments]);

  const activeDeposits = useMemo(
    () => deposits.filter((d) => d.isActive),
    [deposits],
  );

  // Map assignment by machineId (trucks have one assignment each)
  const truckAssignmentMap = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const a of assignments) {
      if (!map.has(a.machineId)) map.set(a.machineId, a);
    }
    return map;
  }, [assignments]);

  const assignedTrucks = useMemo(() => {
    const seen = new Set<string>();
    return assignments
      .filter((a) => {
        if (seen.has(a.machineId)) return false;
        seen.add(a.machineId);
        return true;
      })
      .map((a) => ({
        machineId: a.machineId,
        code: a.machineCode,
        plate: a.registrationPlate,
        assignment: truckAssignmentMap.get(a.machineId)!,
      }));
  }, [assignments, truckAssignmentMap]);

  const handleAssignTruck = useCallback(
    (machineId: string) => {
      clientLogger.flow('Truck plan: assign truck', {
        board: 'truck-plan',
        planDate: date,
        machineId,
      });
      createAssignment.mutate({
        assignmentDate: date,
        machineId,
        status: AssignmentStatus.in_progress,
        sequenceOrder: 0,
      });
    },
    [date, createAssignment],
  );

  const handleRemoveTruck = useCallback(
    (assignmentId: string) => {
      clientLogger.flow('Truck plan: remove truck assignment', {
        board: 'truck-plan',
        planDate: date,
        assignmentId,
      });
      deleteAssignment.mutate(assignmentId);
    },
    [date, deleteAssignment],
  );

  const handleSetLoader = useCallback(
    (assignmentId: string, parentAssignmentId: string | null) => {
      clientLogger.flow('Truck plan: set loader parent', {
        board: 'truck-plan',
        planDate: date,
        assignmentId,
        parentAssignmentId,
      });
      updateAssignment.mutate({
        id: assignmentId,
        data: { parentAssignmentId },
      });
    },
    [date, updateAssignment],
  );

  const handleSetDeposit = useCallback(
    (assignmentId: string, destinationId: string | null) => {
      clientLogger.flow('Truck plan: set deposit', {
        board: 'truck-plan',
        planDate: date,
        assignmentId,
        destinationId,
      });
      updateAssignment.mutate({
        id: assignmentId,
        data: { destinationId },
      });
    },
    [date, updateAssignment],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      {/* Left: Available trucks */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-600">
          {t('tasks.availableMachines', { count: availableTrucks.length })}
        </h3>
        <div className="space-y-2">
          {availableTrucks.length === 0 ? (
            <p className="text-xs text-neutral-400 px-3 py-4 text-center rounded-lg border border-dashed border-neutral-200">
              {t('tasks.allAssigned')}
            </p>
          ) : (
            availableTrucks.map((m) => (
              <button
                key={m.id}
                onClick={() => handleAssignTruck(m.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-green-200 px-4 py-3 text-left transition-colors hover:bg-green-50 hover:shadow-sm"
              >
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                <div>
                  <p className="text-sm font-medium text-neutral-800">{m.internalCode}</p>
                  <p className="text-xs text-neutral-400">{m.registrationPlate}</p>
                </div>
                <Plus className="ml-auto h-4 w-4 text-green-400" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Assigned trucks with loader + deposit */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-600">
          {t('tasks.assignedMachines')}
        </h3>
        {assignedTrucks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 py-16 text-neutral-400">
            <p className="text-sm">{t('tasks.noAssignments')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assignedTrucks.map(({ machineId, code, plate, assignment }) => (
              <div key={machineId} className="rounded-lg border border-green-200 bg-white shadow-sm">
                {/* Truck header */}
                <div className="flex items-center justify-between rounded-t-lg bg-green-50 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                    <span className="font-medium text-neutral-800 text-sm">{code}</span>
                    <span className="text-xs text-neutral-400">{plate}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveTruck(assignment.id)}
                    className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Loader selector */}
                <div className="border-t border-neutral-100 px-4 py-3 space-y-2">
                  <label className="block text-xs font-medium text-neutral-500">
                    {t('tasks.selectLoader')}
                  </label>
                  <div className="flex flex-wrap items-stretch gap-2">
                    <select
                      value={assignment.parentAssignmentId ?? ''}
                      onChange={(e) => handleSetLoader(assignment.id, e.target.value || null)}
                      className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">{t('tasks.noLoaderAssigned')}</option>
                      {uniqueLoaders.map((la) => (
                        <option key={la.id} value={la.id}>
                          {la.machineCode} ({la.registrationPlate})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={uniqueLoaders.length === 0}
                      onClick={() => setLoaderMapForTruckAssignmentId(assignment.id)}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {t('tasks.selectLoaderOnMap')}
                    </button>
                  </div>
                </div>

                {/* Deposit selector */}
                <div className="border-t border-neutral-100 px-4 py-3 space-y-2">
                  <label className="block text-xs font-medium text-neutral-500">
                    {t('tasks.selectDeposit')}
                  </label>
                  <div className="flex flex-wrap items-stretch gap-2">
                    <select
                      value={assignment.destinationId ?? ''}
                      onChange={(e) => handleSetDeposit(assignment.id, e.target.value || null)}
                      className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">{t('tasks.noDepositAssigned')}</option>
                      {activeDeposits.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={activeDeposits.length === 0}
                      onClick={() => setDepositMapForTruckAssignmentId(assignment.id)}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {t('tasks.selectDepositOnMap')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {loaderMapForTruckAssignmentId != null && (
        <LoaderPickMapModal
          loaderAssignments={uniqueLoaders.map((la) => ({
            id: la.id,
            machineId: la.machineId,
            machineCode: la.machineCode,
            registrationPlate: la.registrationPlate,
          }))}
          onSelect={(loaderAssignmentId) => {
            handleSetLoader(loaderMapForTruckAssignmentId, loaderAssignmentId);
            setLoaderMapForTruckAssignmentId(null);
          }}
          onClose={() => setLoaderMapForTruckAssignmentId(null)}
        />
      )}

      {depositMapForTruckAssignmentId != null && (
        <DepositMapModal
          deposits={activeDeposits}
          onSelect={(destinationId) => {
            handleSetDeposit(depositMapForTruckAssignmentId, destinationId);
            setDepositMapForTruckAssignmentId(null);
          }}
          onClose={() => setDepositMapForTruckAssignmentId(null)}
        />
      )}
    </div>
  );
}

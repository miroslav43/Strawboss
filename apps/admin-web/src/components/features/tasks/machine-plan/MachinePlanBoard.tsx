'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import type { Draggable, Droppable } from '@dnd-kit/dom';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';
import { Plus, X, Loader2, GripVertical, Search, MapPin } from 'lucide-react';
import {
  useTasksByMachineType,
  useCreateTaskAssignment,
  useDeleteTaskAssignment,
  useParcels,
  useMachines,
  queryKeys,
} from '@strawboss/api';
import type { Parcel, Machine } from '@strawboss/types';
import { AssignmentStatus } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { clientLogger } from '@/lib/client-logger';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { normalizeList as normalize } from '@/lib/normalize-api-list';

const ParcelMapModal = dynamic(
  () =>
    import('@/components/features/tasks/daily-plan/ParcelMapModal').then((m) => m.ParcelMapModal),
  { ssr: false },
);

interface Assignment {
  id: string;
  machineId: string;
  machineCode: string;
  machineType: string;
  registrationPlate: string;
  parcelId: string | null;
  parcelName: string | null;
  parcelCode: string | null;
  sequenceOrder: number;
  status: string;
}

// ─── ParcelPicker ────────────────────────────────────────────────────────────

function ParcelPicker({
  parcels,
  assignedParcelIds,
  onSelect,
  onClose,
}: {
  parcels: Parcel[];
  assignedParcelIds: Set<string>;
  onSelect: (parcelId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parcels.filter((p) => {
      if (!p.isActive) return false;
      if (assignedParcelIds.has(p.id)) return false;
      if (q && ![p.name, p.code, p.municipality].some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [parcels, assignedParcelIds, search]);

  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-neutral-400" />
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tasks.selectParcel')}
          className="flex-1 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
        />
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-neutral-400">{t('tasks.noParcelResults')}</li>
        ) : (
          filtered.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { onSelect(p.id); onClose(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-mono text-xs text-neutral-500">{p.code}</span>
                <span className="truncate text-neutral-700">{p.name || '—'}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

const PARCEL_SORT_TRANSITION = {
  duration: 220,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  idle: true as const,
};

type ParcelInsertHint = {
  targetId: string;
  /** true = slot above this row (pointer in upper half of row) */
  insertBefore: boolean;
};

function pointerClientY(
  native: Event | undefined,
  fallbackY: number | undefined,
): number | null {
  if (
    native &&
    'clientY' in native &&
    typeof (native as PointerEvent).clientY === 'number'
  ) {
    return (native as PointerEvent).clientY;
  }
  const te = native as TouchEvent | undefined;
  if (te?.touches?.[0]) {
    return te.touches[0].clientY;
  }
  if (typeof fallbackY === 'number' && Number.isFinite(fallbackY)) {
    return fallbackY;
  }
  return null;
}

function SortableParcelRow({
  assignment,
  index,
  parcelCount,
  groupId,
  insertHint,
  onRemove,
  t,
}: {
  assignment: Assignment;
  index: number;
  parcelCount: number;
  groupId: string;
  insertHint: ParcelInsertHint | null;
  onRemove: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const { ref, handleRef, isDragging, isDropTarget, isDragSource } = useSortable({
    id: assignment.id,
    index,
    group: groupId,
    feedback: 'move',
    transition: PARCEL_SORT_TRANSITION,
  });

  const showInsertBefore =
    insertHint?.targetId === assignment.id && insertHint.insertBefore;
  const showInsertAfter =
    insertHint?.targetId === assignment.id && !insertHint.insertBefore;
  const isLast = index === parcelCount - 1;

  return (
    <li
      ref={ref}
      className={cn(
        'relative m-0 flex list-none items-center gap-2 px-3 py-2.5 text-sm',
        // Avoid CSS transitions while dragging — they fight @dnd-kit DOM moves and feel like flicker.
        !isDragging && 'transition-[box-shadow,opacity] duration-200 ease-out',
        isDragging &&
          'z-30 scale-[1.02] rounded-md bg-white shadow-xl ring-2 ring-primary/25',
        isDropTarget && !isDragSource && !isDragging && 'bg-primary/[0.06]',
      )}
    >
      {showInsertBefore && (
        <span
          className={cn(
            'pointer-events-none absolute left-0 right-0 z-40 flex items-center',
            index === 0 ? 'top-0' : 'top-0 -translate-y-1/2',
          )}
          aria-hidden
        >
          <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-primary ring-2 ring-white" />
          <span className="h-0.5 flex-1 bg-primary shadow-sm shadow-primary/30" />
        </span>
      )}
      {showInsertAfter && (
        <span
          className={cn(
            'pointer-events-none absolute left-0 right-0 z-40 flex items-center',
            isLast ? 'bottom-0' : 'bottom-0 translate-y-1/2',
          )}
          aria-hidden
        >
          <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-primary ring-2 ring-white" />
          <span className="h-0.5 flex-1 bg-primary shadow-sm shadow-primary/30" />
        </span>
      )}
      <button
        type="button"
        ref={handleRef}
        className={cn(
          'inline-flex shrink-0 cursor-grab touch-none rounded p-0.5 text-neutral-300',
          'hover:bg-neutral-100 hover:text-neutral-500',
          'active:cursor-grabbing',
        )}
        title={t('tasks.reorderHint')}
        aria-label={t('tasks.reorderHint')}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-xs text-neutral-400 tabular-nums">{index + 1}.</span>
      <span className="min-w-0 flex-1 truncate text-neutral-700">
        {assignment.parcelName || assignment.parcelCode || '—'}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-500"
        title={t('tasks.removeParcel')}
        aria-label={t('tasks.removeParcel')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function SortableParcelListBody({
  groupId,
  parcelRows,
  insertHint,
  onRemoveAssignment,
  t,
}: {
  groupId: string;
  parcelRows: Assignment[];
  insertHint: ParcelInsertHint | null;
  onRemoveAssignment: (id: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const n = parcelRows.length;

  return (
    <ul
      className="relative m-0 list-none divide-y divide-neutral-100 overflow-visible px-0 py-2"
      aria-label={t('tasks.parcelReorderListLabel')}
    >
      {parcelRows.map((a, idx) => (
        <SortableParcelRow
          key={a.id}
          assignment={a}
          index={idx}
          parcelCount={n}
          groupId={groupId}
          insertHint={insertHint}
          onRemove={() => onRemoveAssignment(a.id)}
          t={t}
        />
      ))}
    </ul>
  );
}

function SortableParcelRows({
  machineId,
  parcelRows,
  onReorderParcels,
  onRemoveAssignment,
  t,
}: {
  machineId: string;
  parcelRows: Assignment[];
  onReorderParcels: (fromIndex: number, toIndex: number) => void;
  onRemoveAssignment: (id: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const groupId = `parcel-machine-${machineId}`;
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  const [insertHint, setInsertHint] = useState<ParcelInsertHint | null>(null);

  const handleDragStart = useCallback(() => {
    setInsertHint(null);
  }, []);

  const handleDragMove = useCallback(
    (event: {
      operation: { source: unknown; target: unknown };
      nativeEvent?: Event;
      to?: { x: number; y: number };
      defaultPrevented?: boolean;
    }) => {
      if (event.defaultPrevented) return;
      const src = event.operation.source as Draggable | null;
      if (!src || !isSortable(src) || src.sortable.group !== groupIdRef.current) {
        return;
      }
      const target = event.operation.target as Droppable | null;
      const y = pointerClientY(event.nativeEvent, event.to?.y);
      if (!target || y == null) {
        // Sticky hint: do not clear on transient missing target/y (avoids flicker vs dnd-kit).
        return;
      }
      const el = target.element;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const insertBefore = y < rect.top + rect.height / 2;
      const next: ParcelInsertHint = { targetId: String(target.id), insertBefore };
      setInsertHint((prev) => {
        if (
          prev &&
          prev.targetId === next.targetId &&
          prev.insertBefore === next.insertBefore
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const handleDragEnd = useCallback(
    (event: { canceled?: boolean; operation?: { source: unknown } }) => {
      setInsertHint(null);
      if (event.canceled) return;
      const raw = event.operation?.source as Draggable | Droppable | null | undefined;
      const source = raw ?? null;
      if (!isSortable(source)) return;
      const { initialIndex, index } = source.sortable;
      if (initialIndex !== index) {
        onReorderParcels(initialIndex, index);
      }
    },
    [onReorderParcels],
  );

  if (parcelRows.length === 0) return null;

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <SortableParcelListBody
        groupId={groupId}
        parcelRows={parcelRows}
        insertHint={insertHint}
        onRemoveAssignment={onRemoveAssignment}
        t={t}
      />
    </DragDropProvider>
  );
}

// ─── AssignedMachineCard ─────────────────────────────────────────────────────

function AssignedMachineCard({
  machine,
  assignments,
  parcels,
  allAssignedParcelIds,
  onAddParcel,
  onRemoveAssignment,
  onReorderParcels,
  onUnassignMachine,
  color,
}: {
  machine: { id: string; code: string; plate: string };
  assignments: Assignment[];
  parcels: Parcel[];
  allAssignedParcelIds: Set<string>;
  onAddParcel: (machineId: string, parcelId: string) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onReorderParcels: (fromIndex: number, toIndex: number) => void;
  onUnassignMachine: () => void;
  color: string;
}) {
  const { t } = useI18n();
  const [showPicker, setShowPicker] = useState(false);
  const [showParcelMap, setShowParcelMap] = useState(false);

  const parcelRows = useMemo(
    () =>
      [...assignments]
        .filter((a) => a.parcelId)
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder),
    [assignments],
  );

  const machineParcelIds = useMemo(
    () => new Set(assignments.map((a) => a.parcelId).filter(Boolean) as string[]),
    [assignments],
  );

  const eligibleParcelsForMap = useMemo(
    () =>
      parcels.filter(
        (p) => p.isActive && !allAssignedParcelIds.has(p.id) && !machineParcelIds.has(p.id),
      ),
    [parcels, allAssignedParcelIds, machineParcelIds],
  );

  return (
    <div className={cn('rounded-lg border bg-white shadow-sm', `border-${color}-200`)}>
      {/* Machine header */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-t-lg px-4 py-2.5',
          `bg-${color}-50`,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', `bg-${color}-500`)} />
          <span className="truncate font-medium text-neutral-800 text-sm">{machine.code}</span>
          <span className="flex-shrink-0 text-xs text-neutral-400">{machine.plate}</span>
        </div>
        <button
          type="button"
          onClick={onUnassignMachine}
          className="flex-shrink-0 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          title={t('tasks.unassignMachine')}
          aria-label={t('tasks.unassignMachine')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Ordered parcel list — @dnd-kit sortable: whole row moves, drop indicator, save on release */}
      <SortableParcelRows
        machineId={machine.id}
        parcelRows={parcelRows}
        onReorderParcels={onReorderParcels}
        onRemoveAssignment={onRemoveAssignment}
        t={t}
      />

      {/* Add parcel: list or map */}
      <div className="relative space-y-2 border-t border-neutral-100 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium transition-colors',
              `text-${color}-600 hover:text-${color}-800`,
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('tasks.addParcel')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowParcelMap(true);
              setShowPicker(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary"
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('tasks.selectOnMap')}
          </button>
        </div>
        {showPicker && (
          <ParcelPicker
            parcels={parcels}
            assignedParcelIds={new Set([...allAssignedParcelIds, ...machineParcelIds])}
            onSelect={(parcelId) => onAddParcel(machine.id, parcelId)}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>

      {showParcelMap && (
        <ParcelMapModal
          parcels={eligibleParcelsForMap}
          onSelect={(parcelId) => {
            onAddParcel(machine.id, parcelId);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
    </div>
  );
}

// ─── MachinePlanBoard ────────────────────────────────────────────────────────

interface MachinePlanBoardProps {
  date: string;
  machineType: 'baler' | 'loader' | 'truck';
  color: string; // tailwind color name: 'amber' | 'blue' | 'green'
}

export function MachinePlanBoard({ date, machineType, color }: MachinePlanBoardProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: rawAssignments, isLoading } = useTasksByMachineType(apiClient, date, machineType);
  const { data: rawParcels } = useParcels(apiClient);
  const { data: rawMachines } = useMachines(apiClient);

  const createAssignment = useCreateTaskAssignment(apiClient);
  const deleteAssignment = useDeleteTaskAssignment(apiClient);

  const assignments = useMemo(
    () => normalize<Assignment>(rawAssignments),
    [rawAssignments],
  );
  const parcels = useMemo(() => normalize<Parcel>(rawParcels), [rawParcels]);
  const machines = useMemo(() => normalize<Machine>(rawMachines), [rawMachines]);

  // All machines of this type
  const typeMachines = useMemo(
    () => machines.filter((m) => m.machineType === machineType && m.isActive),
    [machines, machineType],
  );

  // Assigned machine IDs
  const assignedMachineIds = useMemo(
    () => new Set(assignments.map((a) => a.machineId)),
    [assignments],
  );

  // Available machines = not assigned for this date
  const availableMachines = useMemo(
    () => typeMachines.filter((m) => !assignedMachineIds.has(m.id)),
    [typeMachines, assignedMachineIds],
  );

  // Group assignments by machine
  const assignmentsByMachine = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!map.has(a.machineId)) map.set(a.machineId, []);
      map.get(a.machineId)!.push(a);
    }
    return map;
  }, [assignments]);

  // All parcel IDs already assigned to any machine for this type on this date
  const allAssignedParcelIds = useMemo(
    () => new Set(assignments.map((a) => a.parcelId).filter(Boolean) as string[]),
    [assignments],
  );

  // Assigned machines with details
  const assignedMachines = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; code: string; plate: string }[] = [];
    for (const a of assignments) {
      if (!seen.has(a.machineId)) {
        seen.add(a.machineId);
        result.push({
          id: a.machineId,
          code: a.machineCode,
          plate: a.registrationPlate,
        });
      }
    }
    return result;
  }, [assignments]);

  // Handlers
  const handleAssignMachine = useCallback(
    (machineId: string) => {
      clientLogger.flow('Machine plan: assign machine', {
        board: 'machine-plan',
        planDate: date,
        machineType,
        machineId,
      });
      createAssignment.mutate({
        assignmentDate: date,
        machineId,
        status: AssignmentStatus.in_progress,
        sequenceOrder: 0,
      });
    },
    [date, machineType, createAssignment],
  );

  const handleAddParcel = useCallback(
    (machineId: string, parcelId: string) => {
      clientLogger.flow('Machine plan: add parcel to machine', {
        board: 'machine-plan',
        planDate: date,
        machineType,
        machineId,
        parcelId,
      });
      createAssignment.mutate({
        assignmentDate: date,
        machineId,
        parcelId,
        status: AssignmentStatus.in_progress,
        sequenceOrder: 0,
      });
    },
    [date, machineType, createAssignment],
  );

  const handleRemoveAssignment = useCallback(
    (assignmentId: string) => {
      clientLogger.flow('Machine plan: remove assignment', {
        board: 'machine-plan',
        planDate: date,
        machineType,
        assignmentId,
      });
      deleteAssignment.mutate(assignmentId);
    },
    [date, machineType, deleteAssignment],
  );

  const handleUnassignMachine = useCallback(
    async (machineId: string) => {
      const rows = assignmentsByMachine.get(machineId) ?? [];
      try {
        for (const a of rows) {
          await deleteAssignment.mutateAsync(a.id);
        }
        clientLogger.flow('Machine plan: unassign machine (all rows cleared)', {
          board: 'machine-plan',
          planDate: date,
          machineType,
          machineId,
          count: rows.length,
        });
      } catch (e) {
        clientLogger.error('MachinePlanBoard: clear machine assignments failed', {
          board: 'machine-plan',
          operation: 'clearAssignments',
          err: e instanceof Error ? { message: e.message, stack: e.stack } : e,
        });
      }
    },
    [assignmentsByMachine, date, machineType, deleteAssignment],
  );

  const handleReorderParcels = useCallback(
    async (machineId: string, fromIndex: number, toIndex: number) => {
      const all = assignmentsByMachine.get(machineId) ?? [];
      const withParcel = all
        .filter((a) => a.parcelId)
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= withParcel.length ||
        toIndex >= withParcel.length
      ) {
        return;
      }
      const reordered = [...withParcel];
      const [removed] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, removed);

      const sortedAll = [...all].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      const maxSeq = all.reduce((m, a) => Math.max(m, a.sequenceOrder), 0);
      // Temp slots must be above any current order and wide enough to fit all rows (avoids 23505 vs shell / stale 1000+).
      const baseTemp = maxSeq + sortedAll.length + 50;

      try {
        // Use apiClient.patch here (not useUpdateTaskAssignment) so each PATCH does not
        // invalidate task-assignment queries — intermediate sequence_order values look wrong
        // in the UI if we refetch after every request.
        // Phase A: every row for this machine → unique high slots (frees 0..n for parcels + shell).
        for (let i = 0; i < sortedAll.length; i++) {
          await apiClient.patch(`/api/v1/task-assignments/${sortedAll[i].id}`, {
            sequenceOrder: baseTemp + i,
          });
        }
        // Phase B: parcel rows → 0 .. k-1 in new order.
        for (let i = 0; i < reordered.length; i++) {
          await apiClient.patch(`/api/v1/task-assignments/${reordered[i].id}`, {
            sequenceOrder: i,
          });
        }
        // Phase C: shell rows (no parcel) → k .. (keeps UNIQUE with parcel orders).
        const shells = all
          .filter((a) => !a.parcelId)
          .sort((a, b) => a.id.localeCompare(b.id));
        let seq = reordered.length;
        for (const s of shells) {
          await apiClient.patch(`/api/v1/task-assignments/${s.id}`, {
            sequenceOrder: seq,
          });
          seq += 1;
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskAssignments.all });
        clientLogger.flow('Machine plan: parcel reorder persisted', {
          board: 'machine-plan',
          planDate: date,
          machineType,
          machineId,
        });
      } catch (e) {
        clientLogger.error('MachinePlanBoard: reorder / persist failed', {
          board: 'machine-plan',
          operation: 'reorder',
          err: e instanceof Error ? { message: e.message, stack: e.stack } : e,
        });
      }
    },
    [assignmentsByMachine, date, machineType, queryClient],
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
      {/* Left: Available machines */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-600">
          {t('tasks.availableMachines', { count: availableMachines.length })}
        </h3>
        <div className="space-y-2">
          {availableMachines.length === 0 ? (
            <p className="text-xs text-neutral-400 px-3 py-4 text-center rounded-lg border border-dashed border-neutral-200">
              {t('tasks.allAssigned')}
            </p>
          ) : (
            availableMachines.map((m) => (
              <button
                key={m.id}
                onClick={() => handleAssignMachine(m.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:shadow-sm',
                  `border-${color}-200 hover:bg-${color}-50`,
                )}
              >
                <div className={cn('h-2.5 w-2.5 rounded-full', `bg-${color}-400`)} />
                <div>
                  <p className="text-sm font-medium text-neutral-800">{m.internalCode}</p>
                  <p className="text-xs text-neutral-400">{m.registrationPlate}</p>
                </div>
                <Plus className={cn('ml-auto h-4 w-4', `text-${color}-400`)} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Assigned machines with parcels */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-neutral-600">
          {t('tasks.assignedMachines')}
        </h3>
        {assignedMachines.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 py-16 text-neutral-400">
            <p className="text-sm">{t('tasks.noAssignments')}</p>
            <p className="mt-1 text-xs">{t('tasks.dragToAssign')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assignedMachines.map((m) => (
              <AssignedMachineCard
                key={m.id}
                machine={m}
                assignments={assignmentsByMachine.get(m.id) ?? []}
                parcels={parcels}
                allAssignedParcelIds={allAssignedParcelIds}
                onAddParcel={handleAddParcel}
                onRemoveAssignment={handleRemoveAssignment}
                onReorderParcels={(from, to) => handleReorderParcels(m.id, from, to)}
                onUnassignMachine={() => void handleUnassignMachine(m.id)}
                color={color}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { X, CircleDot, Container, Truck, MapPin } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ParcelSelectDropdown } from './ParcelSelectDropdown';
import { ParcelMapModal } from './ParcelMapModal';
import type { PlanMachine } from './DraggablePlanCard';
import type { Parcel } from '@strawboss/types';

interface InProgressAssignment {
  id: string;
  machineId: string;
  machineType: string;
  machineCode: string;
  parcelId: string | null;
  parcelName: string | null;
  parentAssignmentId: string | null;
}

interface AssignmentModalProps {
  machine: PlanMachine;
  date: string;
  parcels: Parcel[];
  doneParcels: Set<string>;
  inProgressAssignments: InProgressAssignment[];
  onAssign: (data: {
    machineId: string;
    parcelId: string | null;
    parentAssignmentId: string | null;
  }) => void;
  onClose: () => void;
}

const machineIcons: Record<string, typeof Truck> = {
  truck: Truck,
  loader: Container,
  baler: CircleDot,
};

const machineLabels: Record<string, string> = {
  baler: 'tasks.balers',
  loader: 'tasks.loaders',
  truck: 'tasks.trucks',
};

export function AssignmentModal({
  machine,
  date,
  parcels,
  doneParcels,
  inProgressAssignments,
  onAssign,
  onClose,
}: AssignmentModalProps) {
  const { t } = useI18n();
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  const Icon = machineIcons[machine.machineType] ?? Truck;

  // For balers: select a parcel
  // For loaders: select a baler (parent)
  // For trucks: select a loader (parent)
  const isBaler = machine.machineType === 'baler';
  const isLoader = machine.machineType === 'loader';
  const isTruck = machine.machineType === 'truck';

  // Available parents based on machine type
  const availableParents = inProgressAssignments.filter((a) => {
    if (isLoader) return a.machineType === 'baler';
    if (isTruck) return a.machineType === 'loader';
    return false;
  });

  // Group parents by parcel for display
  const parentsByParcel = new Map<string, InProgressAssignment[]>();
  for (const a of availableParents) {
    const key = a.parcelName ?? a.parcelId ?? 'unknown';
    if (!parentsByParcel.has(key)) parentsByParcel.set(key, []);
    parentsByParcel.get(key)!.push(a);
  }

  const canSubmit = isBaler
    ? !!selectedParcelId
    : !!selectedParentId;

  const handleSubmit = () => {
    if (isBaler && selectedParcelId) {
      onAssign({ machineId: machine.id, parcelId: selectedParcelId, parentAssignmentId: null });
    } else if (selectedParentId) {
      const parent = inProgressAssignments.find((a) => a.id === selectedParentId);
      onAssign({
        machineId: machine.id,
        parcelId: parent?.parcelId ?? null,
        parentAssignmentId: selectedParentId,
      });
    }
  };

  if (showMap) {
    return (
      <ParcelMapModal
        parcels={parcels.filter((p) => p.isActive)}
        onSelect={(id) => {
          setSelectedParcelId(id);
          setShowMap(false);
        }}
        onClose={() => setShowMap(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[min(90vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <Icon className="h-5 w-5 text-primary" />
            {t('tasks.assignMachine')}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Machine info */}
        <div className="shrink-0 border-b border-neutral-100 bg-neutral-50 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              machine.machineType === 'baler' && 'bg-amber-100 text-amber-600',
              machine.machineType === 'loader' && 'bg-blue-100 text-blue-600',
              machine.machineType === 'truck' && 'bg-green-100 text-green-600',
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-neutral-800">{machine.internalCode}</p>
              <p className="text-sm text-neutral-500">
                {machine.registrationPlate} - {t(machineLabels[machine.machineType] ?? 'tasks.machines')}
              </p>
            </div>
          </div>
        </div>

        {/* Selection content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isBaler && (
            <ParcelSelectDropdown
              parcels={parcels}
              doneParcels={doneParcels}
              selectedParcelId={selectedParcelId}
              onSelect={setSelectedParcelId}
              onOpenMap={() => setShowMap(true)}
            />
          )}

          {(isLoader || isTruck) && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700">
                {isLoader ? t('tasks.associateWithBaler') : t('tasks.associateWithLoader')}
              </label>

              {availableParents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
                  {isLoader ? t('tasks.noBalersInProgress') : t('tasks.noLoadersInProgress')}
                </p>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {Array.from(parentsByParcel.entries()).map(([parcelName, parents]) => (
                    <div key={parcelName}>
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        <MapPin className="h-3 w-3" />
                        {parcelName}
                      </p>
                      {parents.map((parent) => {
                        const ParentIcon = machineIcons[parent.machineType] ?? Truck;
                        return (
                          <button
                            key={parent.id}
                            type="button"
                            onClick={() => setSelectedParentId(parent.id)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                              selectedParentId === parent.id
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50',
                            )}
                          >
                            <ParentIcon className="h-4 w-4 flex-shrink-0" />
                            <span className="text-sm font-medium">{parent.machineCode}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('tasks.assign')}
          </button>
        </div>
      </div>
    </div>
  );
}

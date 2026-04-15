'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MapPin, Loader2 } from 'lucide-react';
import { useMachineLocations } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const LeafletMap = dynamic(
  () => import('@/components/map/LeafletMap').then((m) => m.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    ),
  },
);

export interface LoaderAssignmentRow {
  id: string;
  machineId: string;
  machineCode: string;
  registrationPlate: string;
}

export interface LoaderPickMapModalProps {
  loaderAssignments: LoaderAssignmentRow[];
  onSelect: (loaderAssignmentId: string) => void;
  onClose: () => void;
}

export function LoaderPickMapModal({
  loaderAssignments,
  onSelect,
  onClose,
}: LoaderPickMapModalProps) {
  const { t } = useI18n();
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const { data: locations = [], isLoading } = useMachineLocations(apiClient);

  const allowedMachineIds = useMemo(
    () => new Set(loaderAssignments.map((r) => r.machineId)),
    [loaderAssignments],
  );

  const machinesOnMap = useMemo(
    () =>
      locations.filter(
        (m) => m.machineType === 'loader' && allowedMachineIds.has(m.machineId),
      ),
    [locations, allowedMachineIds],
  );

  const selectedRow = useMemo(() => {
    if (!selectedMachineId) return undefined;
    return loaderAssignments.find((r) => r.machineId === selectedMachineId);
  }, [loaderAssignments, selectedMachineId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <MapPin className="h-5 w-5 text-primary" />
            {t('tasks.selectLoaderOnMap')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-neutral-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <LeafletMap
              parcels={[]}
              machines={machinesOnMap}
              selectedParcelId={null}
              onParcelSelect={() => {}}
              onParcelEdit={() => {}}
              onParcelDelete={() => {}}
              hiddenParcelIds={new Set()}
              hiddenMachineIds={new Set()}
              selectedMachineId={selectedMachineId}
              onMachineMarkerSelect={(machineId) => setSelectedMachineId(machineId)}
              selectionOnly
            />
          )}
        </div>

        <div className="flex flex-col gap-1 border-t border-neutral-200 px-6 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            {selectedRow ? (
              <p>
                {t('tasks.selected')}: {selectedRow.machineCode} ({selectedRow.registrationPlate})
              </p>
            ) : machinesOnMap.length === 0 ? (
              <p>{t('tasks.noLoaderOnMap')}</p>
            ) : (
              <p>{t('tasks.clickLoaderOnMap')}</p>
            )}
            <p className="text-xs text-neutral-400">{t('tasks.mapLoadersNeedGps')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedRow) {
                  onSelect(selectedRow.id);
                  onClose();
                }
              }}
              disabled={!selectedRow}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('tasks.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

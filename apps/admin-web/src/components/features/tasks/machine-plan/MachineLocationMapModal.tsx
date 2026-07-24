'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MapPin, Loader2 } from 'lucide-react';
import { useMachineLocations } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const LeafletMap = dynamic(() => import('@/components/map/LeafletMap').then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-neutral-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

export interface MachineLocationMapModalProps {
  /** The machine to center on. */
  machineId: string;
  /** Human label for the header (code / plate). */
  machineLabel: string;
  onClose: () => void;
}

/**
 * Read-only map that opens centered on one machine's exact last position. Reuses
 * the whole-fleet location feed for context markers and LeafletMap's one-shot
 * `navigateToMachineId` to pan/zoom + open the machine's popup.
 */
export function MachineLocationMapModal({
  machineId,
  machineLabel,
  onClose,
}: MachineLocationMapModalProps) {
  const { t } = useI18n();
  const { data: locations = [], isLoading } = useMachineLocations(apiClient);
  // One-shot focus: LeafletMap pans to the machine, then clears this via
  // onNavigationComplete so a later manual pan is not yanked back.
  const [navigateToMachineId, setNavigateToMachineId] = useState<string | null>(machineId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <MapPin className="h-5 w-5 text-primary" />
            {t('tasks.machineLocation')}
            <span className="text-sm font-normal text-neutral-400">· {machineLabel}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-neutral-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <LeafletMap
              parcels={[]}
              machines={locations}
              selectedParcelId={null}
              onParcelSelect={() => {}}
              onParcelEdit={() => {}}
              onParcelDelete={() => {}}
              hiddenParcelIds={new Set()}
              hiddenMachineIds={new Set()}
              selectedMachineId={machineId}
              onMachineMarkerSelect={() => {}}
              navigateToMachineId={navigateToMachineId}
              onNavigationComplete={() => setNavigateToMachineId(null)}
              selectionOnly
            />
          )}
        </div>
      </div>
    </div>
  );
}

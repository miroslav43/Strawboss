'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MapPin, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Parcel } from '@strawboss/types';

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

interface ParcelMapModalProps {
  parcels: Parcel[];
  onSelect: (parcelId: string) => void;
  onClose: () => void;
}

export function ParcelMapModal({ parcels, onSelect, onClose }: ParcelMapModalProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedParcel = parcels.find((p) => p.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <MapPin className="h-5 w-5 text-primary" />
            {t('tasks.selectOnMap')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Map */}
        <div className="min-h-0 flex-1">
          <LeafletMap
            parcels={parcels}
            machines={[]}
            selectedParcelId={selectedId}
            onParcelSelect={(id) => setSelectedId(id)}
            onParcelEdit={() => {}}
            onParcelDelete={() => {}}
            hiddenParcelIds={new Set()}
            hiddenMachineIds={new Set()}
            selectionOnly
          />
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-1 border-t border-neutral-200 px-6 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            <p>
              {selectedParcel
                ? `${t('tasks.selected')}: ${selectedParcel.name ?? selectedParcel.code}`
                : t('tasks.clickParcelOnMap')}
            </p>
            <p className="text-xs text-neutral-400">{t('tasks.mapParcelsNeedBoundary')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                if (selectedId) {
                  onSelect(selectedId);
                  onClose();
                }
              }}
              disabled={!selectedId}
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

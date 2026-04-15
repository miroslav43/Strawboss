'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MapPin, Loader2 } from 'lucide-react';
import type { DeliveryDestination } from '@strawboss/types';
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

export interface DepositMapModalProps {
  deposits: DeliveryDestination[];
  onSelect: (destinationId: string) => void;
  onClose: () => void;
}

export function DepositMapModal({ deposits, onSelect, onClose }: DepositMapModalProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = deposits.find((d) => d.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <MapPin className="h-5 w-5 text-primary" />
            {t('tasks.selectDepositOnMap')}
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
          <LeafletMap
            parcels={[]}
            machines={[]}
            selectedParcelId={null}
            onParcelSelect={() => {}}
            onParcelEdit={() => {}}
            onParcelDelete={() => {}}
            hiddenParcelIds={new Set()}
            hiddenMachineIds={new Set()}
            deposits={deposits}
            hiddenDepositIds={new Set()}
            selectedDepositId={selectedId}
            onDepositSelect={(id) => setSelectedId(id)}
            selectionOnly
          />
        </div>

        <div className="flex flex-col gap-1 border-t border-neutral-200 px-6 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-neutral-500">
            <p>
              {selected
                ? `${t('tasks.selected')}: ${selected.name} (${selected.code})`
                : t('tasks.clickDepositOnMap')}
            </p>
            <p className="text-xs text-neutral-400">{t('tasks.mapDepositsNeedBoundary')}</p>
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

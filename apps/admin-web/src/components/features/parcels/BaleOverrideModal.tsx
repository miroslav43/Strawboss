'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Loader2, Check, Boxes, Map as MapIcon, ArrowRightLeft } from 'lucide-react';
import {
  useParcelBaleAvailability,
  useOverrideParcelBales,
  useTransferParcelToDepot,
  useDeliveryDestinations,
  useMachines,
} from '@strawboss/api';
import type { Parcel, DeliveryDestination, Machine } from '@strawboss/types';
import { MachineType } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { DepositMapModal } from '@/components/features/tasks/machine-plan/DepositMapModal';
import { BalerPickMapModal } from './BalerPickMapModal';

interface BaleOverrideModalProps {
  parcel: Parcel;
  onClose: () => void;
}

/**
 * Admin tool on the parcels page: manually override a parcel's produced/loaded
 * bale tallies, and transfer produced bales straight into a depot (which marks
 * them loaded off the field and lands them in the depot's inventory).
 */
export function BaleOverrideModal({ parcel, onClose }: BaleOverrideModalProps) {
  const { t } = useI18n();

  const availabilityQuery = useParcelBaleAvailability(apiClient, parcel.id);
  const availability = availabilityQuery.data;

  const destinationsQuery = useDeliveryDestinations(apiClient);
  const depots = useMemo<DeliveryDestination[]>(
    () => normalizeList<DeliveryDestination>(destinationsQuery.data).filter((d) => d.isActive),
    [destinationsQuery.data],
  );

  const machinesQuery = useMachines(apiClient);
  const balers = useMemo<Machine[]>(
    () =>
      normalizeList<Machine>(machinesQuery.data).filter(
        (m) => m.machineType === MachineType.baler && m.isActive,
      ),
    [machinesQuery.data],
  );

  const overrideMutation = useOverrideParcelBales(apiClient);
  const transferMutation = useTransferParcelToDepot(apiClient);

  // Override section
  const [producedInput, setProducedInput] = useState('');
  const [loadedInput, setLoadedInput] = useState('');
  const [reason, setReason] = useState('');
  const [balerId, setBalerId] = useState('');
  const [showBalerMap, setShowBalerMap] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Transfer section
  const [transferDepotId, setTransferDepotId] = useState('');
  const [transferCount, setTransferCount] = useState('');
  const [showMap, setShowMap] = useState(false);

  const [error, setError] = useState('');

  // Prefill inputs from the live tally the first time it arrives.
  useEffect(() => {
    if (availability && !initialized) {
      setProducedInput(String(availability.produced));
      setLoadedInput(String(availability.loaded));
      setTransferCount(String(Math.max(availability.remaining, 0)));
      setInitialized(true);
    }
  }, [availability, initialized]);

  const handleOverride = useCallback(() => {
    setError('');
    const produced = producedInput.trim() === '' ? undefined : parseInt(producedInput, 10);
    const loaded = loadedInput.trim() === '' ? undefined : parseInt(loadedInput, 10);
    if (produced === undefined && loaded === undefined) {
      setError(t('parcels.baleOverride.noValue'));
      return;
    }
    if (
      (produced !== undefined && (Number.isNaN(produced) || produced < 0)) ||
      (loaded !== undefined && (Number.isNaN(loaded) || loaded < 0))
    ) {
      setError(t('parcels.baleOverride.invalidNumber'));
      return;
    }
    overrideMutation.mutate(
      {
        id: parcel.id,
        data: {
          produced,
          loaded,
          reason: reason.trim() || undefined,
          balerId: balerId || undefined,
        },
      },
      {
        onSuccess: (data) => {
          setProducedInput(String(data.produced));
          setLoadedInput(String(data.loaded));
          setError('');
        },
        onError: () => setError(t('parcels.baleOverride.overrideError')),
      },
    );
  }, [producedInput, loadedInput, reason, balerId, parcel.id, overrideMutation, t]);

  const handleTransfer = useCallback(() => {
    setError('');
    if (!transferDepotId) {
      setError(t('parcels.baleOverride.pickDepot'));
      return;
    }
    const count = parseInt(transferCount, 10);
    if (Number.isNaN(count) || count <= 0) {
      setError(t('parcels.baleOverride.invalidCount'));
      return;
    }
    transferMutation.mutate(
      { id: parcel.id, data: { destinationId: transferDepotId, baleCount: count } },
      {
        onSuccess: (data) => {
          setTransferCount(String(Math.max(data.remaining, 0)));
          setLoadedInput(String(data.loaded));
          setError('');
        },
        onError: () => setError(t('parcels.baleOverride.transferError')),
      },
    );
  }, [transferDepotId, transferCount, parcel.id, transferMutation, t]);

  // Map picker takes over the full screen while open — render it INSTEAD of this
  // modal so there is no z-index stacking conflict (DepositMapModal is z-50).
  if (showMap) {
    return (
      <DepositMapModal
        deposits={depots}
        onSelect={(id) => setTransferDepotId(id)}
        onClose={() => setShowMap(false)}
      />
    );
  }

  if (showBalerMap) {
    return (
      <BalerPickMapModal onSelect={(id) => setBalerId(id)} onClose={() => setShowBalerMap(false)} />
    );
  }

  const remaining = availability?.remaining ?? 0;
  const selectedDepot = depots.find((d) => d.id === transferDepotId);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ maxHeight: 'min(90vh, 760px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-800">
            <Boxes className="h-5 w-5 text-primary" />
            {t('parcels.baleOverride.title')}
            <span className="font-normal text-neutral-400">· {parcel.code}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Current tally */}
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['produced', availability?.produced ?? 0],
                ['loaded', availability?.loaded ?? 0],
                ['remaining', remaining],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-xl bg-neutral-50 px-3 py-2 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                  {t(`parcels.baleOverride.${key}`)}
                </div>
                <div className="text-lg font-semibold text-neutral-800">
                  {availabilityQuery.isLoading ? '—' : value}
                </div>
              </div>
            ))}
          </div>

          {/* Section: manual override */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-700">
              {t('parcels.baleOverride.overrideHeading')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {t('parcels.baleOverride.produced')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={producedInput}
                  onChange={(e) => setProducedInput(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {t('parcels.baleOverride.loaded')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={loadedInput}
                  onChange={(e) => setLoadedInput(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                {t('parcels.baleOverride.baler')}
              </label>
              <div className="flex gap-2">
                <select
                  value={balerId}
                  onChange={(e) => setBalerId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t('parcels.baleOverride.selectBaler')}</option>
                  {balers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.internalCode || m.make} ({m.registrationPlate})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowBalerMap(true)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                  title={t('parcels.baleOverride.onMap')}
                >
                  <MapIcon className="h-4 w-4" />
                  {t('parcels.baleOverride.onMap')}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                {t('parcels.baleOverride.reason')}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={t('parcels.baleOverride.reasonPlaceholder')}
              />
            </div>
            <button
              type="button"
              onClick={handleOverride}
              disabled={overrideMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {overrideMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {t('parcels.baleOverride.saveOverride')}
            </button>
          </section>

          <div className="border-t border-neutral-100" />

          {/* Section: transfer to depot */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-700">
              {t('parcels.baleOverride.transferHeading')}
            </h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                {t('parcels.baleOverride.depot')}
              </label>
              <div className="flex gap-2">
                <select
                  value={transferDepotId}
                  onChange={(e) => setTransferDepotId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t('parcels.baleOverride.selectDepot')}</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowMap(true)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                  title={t('parcels.baleOverride.onMap')}
                >
                  <MapIcon className="h-4 w-4" />
                  {t('parcels.baleOverride.onMap')}
                </button>
              </div>
              {selectedDepot && (
                <p className="mt-1 text-xs text-neutral-400">{selectedDepot.address}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                {t('parcels.baleOverride.transferCount')}
              </label>
              <input
                type="number"
                min="1"
                value={transferCount}
                onChange={(e) => setTransferCount(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-neutral-400">
                {t('parcels.baleOverride.remainingHint', { count: remaining })}
              </p>
            </div>
            <button
              type="button"
              onClick={handleTransfer}
              disabled={transferMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {transferMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4" />
              )}
              {t('parcels.baleOverride.transferToDepot')}
            </button>
          </section>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-neutral-100 bg-neutral-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle2, XCircle, Loader2, MapPin, Warehouse, Sprout } from 'lucide-react';
import { useConfirmTripRequest, useDeliveryDestinations, useParcels } from '@strawboss/api';
import type { TripRequest, DeliveryDestination, Parcel } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { normalizeList } from '@/lib/normalize-api-list';
import { FarmParcelCascade } from '@/components/features/tasks/machine-plan/FarmParcelCascade';

const ParcelMapModal = dynamic(
  () =>
    import('@/components/features/tasks/daily-plan/ParcelMapModal').then((m) => m.ParcelMapModal),
  { ssr: false },
);

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// Stable references — FarmParcelCascade takes these as props and re-creating
// them every render would be a pointless allocation (they're both always empty
// in this one-off confirm context: no other assignment exists yet to exclude
// or count against).
const EMPTY_EXCLUDE = new Set<string>();
const EMPTY_ASSIGNED_COUNT = new Map<string, number>();

type SourceType = 'depot' | 'field';

/**
 * Confirm a pending request → mints the one-time auxiliary truck.
 *
 * The pickup point (depot OR field, exactly one) is the informational source
 * communicated to the external driver (an aux transport runs our pickup point →
 * the customer's yard, the opposite direction from a fleet trip) — required.
 */
export function ConfirmRequestModal({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [internalCode, setInternalCode] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('depot');
  const [depotId, setDepotId] = useState('');
  const [parcelId, setParcelId] = useState('');
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [showParcelMap, setShowParcelMap] = useState(false);
  const confirm = useConfirmTripRequest(apiClient);
  const { data: rawDepots } = useDeliveryDestinations(apiClient);
  const { data: rawParcels } = useParcels(apiClient);
  const depots = useMemo(
    () => normalizeList<DeliveryDestination>(rawDepots).filter((d) => d.isActive),
    [rawDepots],
  );
  const parcels = useMemo(() => normalizeList<Parcel>(rawParcels), [rawParcels]);

  // Preselect the default (or first) depot once the list loads.
  useEffect(() => {
    if (!depotId && depots.length) {
      setDepotId((depots.find((d) => d.isDefault) ?? depots[0]).id);
    }
  }, [depots, depotId]);

  const selectedDepot = depots.find((d) => d.id === depotId) ?? null;
  const selectedParcel = parcels.find((p) => p.id === parcelId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = internalCode.trim() || undefined;
    if (sourceType === 'depot') {
      if (!depotId) return;
      confirm.mutate(
        { id: request.id, depotId, internalCode: code },
        { onSuccess: () => onClose() },
      );
    } else {
      if (!parcelId) return;
      confirm.mutate(
        { id: request.id, parcelId, internalCode: code },
        { onSuccess: () => onClose() },
      );
    }
  };

  const pickupLabel =
    sourceType === 'depot'
      ? selectedDepot
        ? `${selectedDepot.name}${selectedDepot.address ? `, ${selectedDepot.address}` : ''}`
        : '—'
      : selectedParcel
        ? `${selectedParcel.code}${selectedParcel.farmName ? `, ${selectedParcel.farmName}` : ''}`
        : '—';

  const canSubmit = sourceType === 'depot' ? !!depotId : !!parcelId;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {t('tripRequests.confirmModalTitle')}
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {request.requesterName} — {request.truckRegistrationPlate}
              </p>
            </div>

            {/* Depot vs. field tabs */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSourceType('depot')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                  sourceType === 'depot'
                    ? 'border-green-400 bg-green-50 text-green-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                )}
              >
                <Warehouse className="h-3.5 w-3.5" />
                {t('tripRequests.sourceTypeDepot')}
              </button>
              <button
                type="button"
                onClick={() => setSourceType('field')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors',
                  sourceType === 'field'
                    ? 'border-green-400 bg-green-50 text-green-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary hover:text-primary',
                )}
              >
                <Sprout className="h-3.5 w-3.5" />
                {t('tripRequests.sourceTypeField')}
              </button>
            </div>

            {sourceType === 'depot' ? (
              <div>
                <label className="block text-sm font-medium text-neutral-700">
                  {t('tripRequests.depotLabel')} <span className="text-red-500">*</span>
                </label>
                <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.depotHint')}</p>
                <select
                  value={depotId}
                  onChange={(e) => setDepotId(e.target.value)}
                  required
                  className={inputCls}
                >
                  <option value="">{t('tripRequests.depotPlaceholder')}</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.address ? ` — ${d.address}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="relative">
                <label className="block text-sm font-medium text-neutral-700">
                  {t('tripRequests.fieldLabel')} <span className="text-red-500">*</span>
                </label>
                <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.fieldHint')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFieldPicker((v) => !v)}
                    className={cn(inputCls, 'flex-1 text-left')}
                  >
                    {selectedParcel
                      ? `${selectedParcel.code}${selectedParcel.farmName ? `, ${selectedParcel.farmName}` : ''}`
                      : t('tripRequests.fieldPlaceholder')}
                  </button>
                  <button
                    type="button"
                    data-cascade-keep-open
                    onClick={() => {
                      setShowParcelMap(true);
                      setShowFieldPicker(false);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {t('tasks.selectOnMap')}
                  </button>
                </div>
                {showFieldPicker && (
                  <FarmParcelCascade
                    parcels={parcels}
                    excludeParcelIds={EMPTY_EXCLUDE}
                    assignedCountByParcel={EMPTY_ASSIGNED_COUNT}
                    color="green"
                    onSelect={(id) => setParcelId(id)}
                    onClose={() => setShowFieldPicker(false)}
                  />
                )}
              </div>
            )}

            <div className="space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
              <p className="flex items-start gap-1.5">
                <Warehouse className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                <span>
                  <span className="font-medium">{t('tripRequests.pickupPreview')}:</span>{' '}
                  {pickupLabel}
                </span>
              </p>
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <span>
                  <span className="font-medium">{t('tripRequests.deliveryPreview')}:</span>{' '}
                  {request.destinationAddress || '—'}
                </span>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">
                {t('tripRequests.internalCodeLabel')}
              </label>
              <p className="mb-1 text-xs text-neutral-500">{t('tripRequests.internalCodeHint')}</p>
              <input
                value={internalCode}
                onChange={(e) => setInternalCode(e.target.value)}
                placeholder={t('tripRequests.internalCodePlaceholder')}
                className={inputCls}
              />
            </div>
            {confirm.isError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {t('tripRequests.confirmError')}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={confirm.isPending || !canSubmit}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirm.isPending ? t('tripRequests.confirming') : t('tripRequests.confirm')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showParcelMap && (
        <ParcelMapModal
          parcels={parcels.filter((p) => p.isActive)}
          onSelect={(parcelIds) => {
            if (parcelIds[0]) setParcelId(parcelIds[0]);
            setShowParcelMap(false);
          }}
          onClose={() => setShowParcelMap(false)}
        />
      )}
    </>
  );
}

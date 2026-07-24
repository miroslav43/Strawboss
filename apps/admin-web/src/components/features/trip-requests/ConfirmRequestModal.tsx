'use client';

import { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, MapPin, Warehouse } from 'lucide-react';
import { useConfirmTripRequest, useDeliveryDestinations } from '@strawboss/api';
import type { TripRequest, DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Confirm a pending request → mints the one-time auxiliary truck.
 *
 * The depot is the PICKUP point (an aux transport runs our depot → the
 * customer's yard, the opposite direction from a fleet trip) and is required —
 * the backend validates it belongs to the org.
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
  const [depotId, setDepotId] = useState('');
  const confirm = useConfirmTripRequest(apiClient);
  const { data: rawDepots } = useDeliveryDestinations(apiClient);
  const depots = useMemo(
    () => normalizeList<DeliveryDestination>(rawDepots).filter((d) => d.isActive),
    [rawDepots],
  );

  // Preselect the default (or first) depot once the list loads.
  useEffect(() => {
    if (!depotId && depots.length) {
      setDepotId((depots.find((d) => d.isDefault) ?? depots[0]).id);
    }
  }, [depots, depotId]);

  const selectedDepot = depots.find((d) => d.id === depotId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depotId) return;
    confirm.mutate(
      { id: request.id, depotId, internalCode: internalCode.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  };

  return (
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
          <div className="space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="flex items-start gap-1.5">
              <Warehouse className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
              <span>
                <span className="font-medium">{t('tripRequests.pickupPreview')}:</span>{' '}
                {selectedDepot
                  ? `${selectedDepot.name}${selectedDepot.address ? `, ${selectedDepot.address}` : ''}`
                  : '—'}
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
              disabled={confirm.isPending || !depotId}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirm.isPending ? t('tripRequests.confirming') : t('tripRequests.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

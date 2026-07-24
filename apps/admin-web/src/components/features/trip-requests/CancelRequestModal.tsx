'use client';

import { useState } from 'react';
import { XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useCancelTripRequest, ApiError } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { RequestStatus } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Cancel a request. The backend refuses once it is confirmed — by then an
 * auxiliary truck exists and possibly a trip, so cancelling is no longer a
 * paperwork decision.
 */
export function CancelRequestModal({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const cancel = useCancelTripRequest(apiClient);

  // The server refuses to cancel a request whose trip is already planned, and says
  // so with a machine-readable code — match on that, not on the message text.
  const hasLiveTrip =
    cancel.error instanceof ApiError &&
    (cancel.error.data as { error?: string } | undefined)?.error === 'has_live_trip';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    cancel.mutate({ id: request.id, reason: reason.trim() || undefined }, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
            <XCircle className="h-5 w-5 text-red-500" />
            {t('tripRequests.cancelModalTitle')}
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
          {/* A confirmed request already has a one-time auxiliary truck minted
              against it. Cancelling retires that truck — say so, rather than letting
              it vanish from the fleet unannounced. */}
          {request.status === RequestStatus.confirmed && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('tripRequests.cancelConfirmedHint')}</span>
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              {t('tripRequests.cancelReasonLabel')}
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('tripRequests.cancelReasonPlaceholder')}
              className={cn(inputCls, 'mt-1')}
            />
          </div>
          {cancel.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {/* The server refuses when a trip is already planned — tell the user
                  what to do about it instead of a generic failure. */}
              {hasLiveTrip ? t('tripRequests.cancelHasTripError') : t('tripRequests.cancelError')}
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
              disabled={cancel.isPending}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {cancel.isPending ? t('tripRequests.cancelling') : t('tripRequests.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useId, useRef } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useDeleteTransporterRequest, ApiError } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Delete one of the transporter's own requests outright.
 *
 * Only ever mounted from a row `AuxTripTable` already gated on
 * `canDeleteAuxStage` — this dialog exists to confirm the action and to
 * surface the server's authoritative refusal if the stage moved on between
 * page load and click (another admin planned it, the loader started, etc.).
 * The backend re-derives the stage itself; this button is a UX nicety, not
 * the enforcement.
 */
export function TransporterDeleteTripDialog({
  request,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const del = useDeleteTransporterRequest(apiClient);
  const titleId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dialog semantics: focus the safe action in on mount, restore focus to the
  // trigger on unmount, close on Escape. onClose is read through a ref so this
  // effect runs once. Same pattern as AvizUploadModal/CmrUploadModal.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  // The server refuses once the transport has moved — match on the
  // machine-readable code, not the message text (same convention as
  // CancelRequestModal's has_live_trip check).
  const blocked =
    del.error instanceof ApiError &&
    (del.error.data as { error?: string } | undefined)?.error === 'stage_not_deletable';

  const label = [request.companyName || request.requesterName, request.truckRegistrationPlate]
    .filter(Boolean)
    .join(' — ');

  const handleDelete = () => {
    del.mutate(request.id, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
          <Trash2 className="h-6 w-6 text-red-500" />
        </div>
        <h2 id={titleId} className="text-base font-semibold text-neutral-800">
          {t('transporter.deleteTrip')}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('transporter.deleteTripConfirm', { name: label })}
        </p>
        {del.isError && (
          <p className="mt-3 text-sm font-medium text-red-600" role="alert">
            {blocked ? t('transporter.deleteTripBlocked') : t('transporter.deleteError')}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={del.isPending}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {del.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {t('transporter.deleteTrip')}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, ClipboardList } from 'lucide-react';
import { useTripRequests, useConfirmTripRequest, useCancelTripRequest } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { RequestStatus } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';

// ── Shared UI atoms (same style as machines/page.tsx) ─────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  const cls =
    status === RequestStatus.pending
      ? 'bg-amber-100 text-amber-700'
      : status === RequestStatus.confirmed
        ? 'bg-green-100 text-green-700'
        : 'bg-neutral-100 text-neutral-500 line-through';
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', cls)}
    >
      {t(`tripRequests.status.${status}`)}
    </span>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────

function ConfirmModal({ request, onClose }: { request: TripRequest; onClose: () => void }) {
  const { t } = useI18n();
  const [internalCode, setInternalCode] = useState('');
  const confirm = useConfirmTripRequest(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    confirm.mutate(
      { id: request.id, internalCode: internalCode.trim() || undefined },
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
              disabled={confirm.isPending}
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

// ── Cancel modal ──────────────────────────────────────────────────────────

function CancelModal({ request, onClose }: { request: TripRequest; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const cancel = useCancelTripRequest(apiClient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    cancel.mutate(
      { id: request.id, reason: reason.trim() || undefined },
      { onSuccess: () => onClose() },
    );
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
              {t('tripRequests.cancelError')}
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

// ── Pending request card ──────────────────────────────────────────────────

function PendingRequestRow({
  request,
  onConfirm,
  onCancel,
}: {
  request: TripRequest;
  onConfirm: (r: TripRequest) => void;
  onCancel: (r: TripRequest) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <StatusBadge status={request.status as RequestStatus} />
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(request)}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('tripRequests.confirm')}
          </button>
          <button
            onClick={() => onCancel(request)}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t('tripRequests.cancel')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Detail label={t('tripRequests.colRequester')} value={request.requesterName} />
        <Detail label={t('tripRequests.requesterPhone')} value={request.requesterPhone} />
        {request.requesterEmail && (
          <Detail label={t('tripRequests.requesterEmail')} value={request.requesterEmail} />
        )}
        {request.companyName && (
          <Detail label={t('tripRequests.colCompany')} value={request.companyName} />
        )}
        <Detail label={t('tripRequests.truckPlate')} value={request.truckRegistrationPlate} />
        {(request.truckMake || request.truckModel) && (
          <Detail
            label={t('tripRequests.colTruck')}
            value={[request.truckMake, request.truckModel].filter(Boolean).join(' ')}
          />
        )}
        {request.truckCapacityTons != null && (
          <Detail
            label={t('tripRequests.truckCapacity')}
            value={`${request.truckCapacityTons} ${t('tripRequests.tons')}`}
          />
        )}
        <Detail label={t('tripRequests.colDriver')} value={request.driverName} />
        <Detail label={t('tripRequests.driverPhone')} value={request.driverPhone} />
        {request.cropType && <Detail label={t('tripRequests.colCrop')} value={request.cropType} />}
        {request.neededDate && (
          <Detail label={t('tripRequests.colNeededDate')} value={request.neededDate} />
        )}
        {request.tonsRequested != null && (
          <Detail
            label={t('tripRequests.colTons')}
            value={`${request.tonsRequested} ${t('tripRequests.tons')}`}
          />
        )}
        {request.destinationAddress && (
          <Detail label={t('tripRequests.destinationAddress')} value={request.destinationAddress} />
        )}
        {request.destinationLocality && (
          <Detail
            label={t('tripRequests.destinationLocality')}
            value={request.destinationLocality}
          />
        )}
        {request.notes && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <Detail label={t('tripRequests.notes')} value={request.notes} />
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="truncate text-sm font-medium text-neutral-800">{value}</p>
    </div>
  );
}

// ── Confirmed / cancelled row ─────────────────────────────────────────────

function ClosedRequestRow({ request }: { request: TripRequest }) {
  const { t } = useI18n();
  return (
    <tr className="border-b border-neutral-100 hover:bg-neutral-50">
      <td className="px-4 py-3">
        <StatusBadge status={request.status as RequestStatus} />
      </td>
      <td className="px-4 py-3 text-sm text-neutral-800">{request.requesterName}</td>
      <td className="px-4 py-3 text-sm text-neutral-600">
        {request.companyName ?? t('tripRequests.none')}
      </td>
      <td className="px-4 py-3 font-mono text-sm text-neutral-700">
        {request.truckRegistrationPlate}
      </td>
      <td className="px-4 py-3 text-sm text-neutral-600">{request.driverName}</td>
      <td className="px-4 py-3 text-sm text-neutral-600">
        {request.cropType ?? t('tripRequests.none')}
      </td>
      <td className="px-4 py-3 text-sm text-neutral-600">
        {request.machineId ? (
          <span className="font-mono text-xs text-neutral-700">
            {request.machineId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-neutral-300">{t('tripRequests.none')}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-neutral-600">
        {request.tripId ? (
          <span className="font-mono text-xs text-neutral-700">{request.tripId.slice(0, 8)}</span>
        ) : (
          <span className="text-neutral-300">{t('tripRequests.none')}</span>
        )}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TripRequestsPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<RequestStatus | ''>('');
  const [confirmTarget, setConfirmTarget] = useState<TripRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TripRequest | null>(null);

  const filterOptions = useMemo(
    () => [
      { value: '', label: t('tripRequests.filterAll') },
      { value: RequestStatus.pending, label: t('tripRequests.filterPending') },
      { value: RequestStatus.confirmed, label: t('tripRequests.filterConfirmed') },
      { value: RequestStatus.cancelled, label: t('tripRequests.filterCancelled') },
    ],
    [t],
  );

  const filters: Record<string, unknown> = {};
  if (statusFilter) filters.status = statusFilter;

  const { data: rawData, isLoading, isError } = useTripRequests(apiClient, filters);
  const requests = useMemo(() => normalizeList<TripRequest>(rawData), [rawData]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === RequestStatus.pending),
    [requests],
  );
  const closedRequests = useMemo(
    () => requests.filter((r) => r.status !== RequestStatus.pending),
    [requests],
  );

  const handleConfirm = useCallback((r: TripRequest) => setConfirmTarget(r), []);
  const handleCancel = useCallback((r: TripRequest) => setCancelTarget(r), []);

  return (
    <div className="space-y-5">
      <PageHeader title={t('tripRequests.title')} />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RequestStatus | '')}
          className={selectCls}
        >
          {filterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center gap-2 py-12 text-center text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}
      {isError && (
        <div className="py-8 text-center text-sm text-red-500">{t('tripRequests.loadError')}</div>
      )}

      {!isLoading && !isError && requests.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 py-16 text-neutral-400">
          <ClipboardList className="mb-2 h-8 w-8" />
          <p className="text-sm">{t('tripRequests.empty')}</p>
        </div>
      )}

      {/* Pending requests — card layout */}
      {!isLoading && !isError && pendingRequests.length > 0 && (
        <div className="space-y-3">
          {pendingRequests.map((r) => (
            <PendingRequestRow
              key={r.id}
              request={r}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}

      {/* Confirmed / cancelled — table layout */}
      {!isLoading && !isError && closedRequests.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">{t('tripRequests.colStatus')}</th>
                <th className="px-4 py-3">{t('tripRequests.colRequester')}</th>
                <th className="px-4 py-3">{t('tripRequests.colCompany')}</th>
                <th className="px-4 py-3">{t('tripRequests.colTruck')}</th>
                <th className="px-4 py-3">{t('tripRequests.colDriver')}</th>
                <th className="px-4 py-3">{t('tripRequests.colCrop')}</th>
                <th className="px-4 py-3">{t('tripRequests.colMachine')}</th>
                <th className="px-4 py-3">{t('tripRequests.colTrip')}</th>
              </tr>
            </thead>
            <tbody>
              {closedRequests.map((r) => (
                <ClosedRequestRow key={r.id} request={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {confirmTarget && (
        <ConfirmModal request={confirmTarget} onClose={() => setConfirmTarget(null)} />
      )}
      {cancelTarget && <CancelModal request={cancelTarget} onClose={() => setCancelTarget(null)} />}
    </div>
  );
}

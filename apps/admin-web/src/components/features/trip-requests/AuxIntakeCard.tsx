'use client';

import { CheckCircle2, XCircle, Eye } from 'lucide-react';
import type { TripRequest } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { fmtDate } from '@/lib/date';
import { DetailField } from '@/components/shared/DetailField';
import { qualityLabelKey } from './labels';

/**
 * A pending request, as the at-a-glance decision card.
 *
 * This stays a CARD rather than a table row on purpose: confirming or cancelling
 * is a judgement call the dispatcher makes from the whole picture at once —
 * phone number, truck capacity, tonnage, destination, notes — and a table row
 * can only show a handful of those without becoming unreadable. Once confirmed,
 * the request becomes a row in the Aux table, where the columns that matter are
 * the ones about execution.
 */
export function AuxIntakeCard({
  request,
  onConfirm,
  onCancel,
  onViewDetails,
}: {
  request: TripRequest;
  onConfirm: (r: TripRequest) => void;
  onCancel: (r: TripRequest) => void;
  onViewDetails: (r: TripRequest) => void;
}) {
  const { t } = useI18n();
  const fmt = useLocaleFormat();

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-800">
          {request.companyName || request.requesterName}
          {/* CUI in the header, not buried in the grid: it is how you actually
              identify the company you are about to commit a truck to. */}
          {request.companyCui && (
            <span className="ml-2 rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px] font-normal text-neutral-600 ring-1 ring-inset ring-amber-200">
              {t('tripRequests.cui')} {request.companyCui}
            </span>
          )}
          <span className="ml-2 font-mono text-xs font-normal text-neutral-500">
            {request.truckRegistrationPlate}
          </span>
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => onViewDetails(request)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Eye className="h-3.5 w-3.5" />
            {t('tripRequests.viewDetails')}
          </button>
          <button
            onClick={() => onConfirm(request)}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('tripRequests.confirm')}
          </button>
          <button
            onClick={() => onCancel(request)}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t('tripRequests.cancel')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <DetailField label={t('tripRequests.colRequester')} value={request.requesterName} />
        <DetailField label={t('tripRequests.requesterPhone')} value={request.requesterPhone} />
        <DetailField label={t('tripRequests.requesterEmail')} value={request.requesterEmail} />
        <DetailField label={t('tripRequests.colCompany')} value={request.companyName} />
        <DetailField label={t('tripRequests.companyCui')} value={request.companyCui} />
        <DetailField label={t('tripRequests.companyAddress')} value={request.companyAddress} />
        <DetailField
          label={t('tripRequests.colTruck')}
          value={[request.truckMake, request.truckModel].filter(Boolean).join(' ') || null}
        />
        <DetailField
          label={t('tripRequests.truckCapacity')}
          value={
            request.truckCapacityTons != null
              ? `${request.truckCapacityTons} ${t('tripRequests.tons')}`
              : null
          }
        />
        <DetailField label={t('tripRequests.colDriver')} value={request.driverName} />
        <DetailField label={t('tripRequests.driverPhone')} value={request.driverPhone} />
        <DetailField label={t('tripRequests.colCrop')} value={request.cropType} />
        <DetailField
          label={t('tripRequests.quality')}
          value={request.quality ? t(qualityLabelKey(request.quality)) : null}
        />
        <DetailField
          label={t('tripRequests.colNeededDate')}
          value={request.neededDate ? fmtDate(request.neededDate, fmt.tag) : null}
        />
        <DetailField
          label={t('tripRequests.colTons')}
          value={
            request.tonsRequested != null
              ? `${request.tonsRequested} ${t('tripRequests.tons')}`
              : null
          }
        />
        <DetailField
          label={t('tripRequests.destinationAddress')}
          value={request.destinationAddress}
        />
        <DetailField
          label={t('tripRequests.destinationLocality')}
          value={request.destinationLocality}
        />
        {request.notes && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <DetailField label={t('tripRequests.notes')} value={request.notes} />
          </div>
        )}
      </div>
    </div>
  );
}

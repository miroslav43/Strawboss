'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import { useTransporterRequests } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { AUX_STAGE_ORDER } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { buildAuxRows, type AuxRow } from '@/lib/aux-rows';
import { fmtDate, fmtDateTime, romaniaDateString } from '@/lib/date';
import { exportXlsx, type XlsxColumn } from '@/lib/xlsx';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { AuxTripTable } from '@/components/features/trips/AuxTripTable';
import { RequestDetailsModal } from '@/components/features/trip-requests/RequestDetailsModal';
import { AvizUploadModal } from '@/components/features/trip-requests/AvizUploadModal';
import { CmrUploadModal } from '@/components/features/trip-requests/CmrUploadModal';
import { qualityLabelKey } from '@/components/features/trip-requests/labels';
import { ComandaModal } from './ComandaModal';
import { TransporterDeleteTripDialog } from './TransporterDeleteTripDialog';

const inputCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// All stages, pending INCLUDED: the transporter has no intake strip, so a
// just-submitted (still-pending) request must be visible in their own ledger.
const STAGE_OPTIONS = AUX_STAGE_ORDER;

/**
 * The transporter's ledger — the aux transports THEY created, rendered through
 * the same AuxStage lifecycle the admin ledger uses (buildAuxRows + AuxTripTable
 * in `readOnly` mode: no confirm/cancel/unplan, and the row itself isn't
 * editable). Document upload IS wired though — aviz + both CMRs (departure and
 * arrival) — so the transporter can attach a document on the driver's behalf
 * even though they cannot otherwise change the transport's state. Row click
 * opens the read-only details modal.
 */
export default function TransporterTripsPage() {
  const { t } = useI18n();
  const slug = useOrgSlug();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [detailsTarget, setDetailsTarget] = useState<TripRequest | null>(null);
  const [avizTarget, setAvizTarget] = useState<TripRequest | null>(null);
  const [cmrTarget, setCmrTarget] = useState<TripRequest | null>(null);
  const [cmrArrivalTarget, setCmrArrivalTarget] = useState<TripRequest | null>(null);
  const [comandaTarget, setComandaTarget] = useState<TripRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TripRequest | null>(null);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (search) f.search = search;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    return Object.keys(f).length ? f : undefined;
  }, [search, dateFrom, dateTo]);

  const { data, isLoading, isError } = useTransporterRequests(apiClient, filters);
  const requests = useMemo(() => normalizeList<TripRequest>(data), [data]);
  const allRows = useMemo(() => buildAuxRows(requests), [requests]);
  const rows = useMemo(
    () => (stageFilter ? allRows.filter((r) => r.stage === stageFilter) : allRows),
    [allRows, stageFilter],
  );

  // Exports exactly what's on screen — i.e. the active search/date/stage
  // filters — with every field of the request, not just the 10 visible
  // columns. Booleans render as Da/Nu so the sheet reads naturally in Excel.
  const handleExport = () => {
    const yesNo = (v: boolean | undefined) => (v ? t('common.yes') : t('common.no'));
    const columns: XlsxColumn<AuxRow>[] = [
      { header: t('tripRequests.colStatus'), value: (r) => t(`tripRequests.stage.${r.stage}`) },
      {
        header: t('tripRequests.colRequester'),
        value: (r) => r.request.companyName || r.request.requesterName,
      },
      { header: t('transporter.export.requesterName'), value: (r) => r.request.requesterName },
      { header: t('transporter.export.requesterPhone'), value: (r) => r.request.requesterPhone },
      { header: t('transporter.export.requesterEmail'), value: (r) => r.request.requesterEmail },
      { header: t('tripRequests.colTruck'), value: (r) => r.request.truckRegistrationPlate },
      {
        header: t('transporter.export.trailerPlate'),
        value: (r) => r.request.trailerRegistrationPlate,
      },
      {
        header: t('transporter.export.truckMakeModel'),
        value: (r) => [r.request.truckMake, r.request.truckModel].filter(Boolean).join(' '),
      },
      { header: t('tripRequests.colDriver'), value: (r) => r.request.driverName },
      { header: t('transporter.export.driverPhone'), value: (r) => r.request.driverPhone },
      { header: t('tripRequests.colCrop'), value: (r) => r.request.cropType },
      {
        header: t('transporter.export.quality'),
        value: (r) => (r.request.quality ? t(qualityLabelKey(r.request.quality)) : null),
      },
      { header: t('transporter.export.tonsRequested'), value: (r) => r.request.tonsRequested },
      {
        header: t('transporter.export.pickupParcel'),
        value: (r) => r.request.tripSourceParcelName ?? r.request.sourceParcelName,
      },
      {
        header: t('transporter.export.pickupDepot'),
        value: (r) => r.request.tripSourceDepotName ?? r.request.sourceDepotName,
      },
      { header: t('tripRequests.colDestination'), value: (r) => r.request.destinationLocality },
      {
        header: t('transporter.export.destinationAddress'),
        value: (r) => r.request.destinationAddress,
      },
      {
        header: t('tripRequests.colNeededDate'),
        value: (r) => fmtDate(r.request.neededDate),
      },
      {
        header: t('transporter.export.unloadingDate'),
        value: (r) => fmtDate(r.request.unloadingDate),
      },
      { header: t('tripRequests.colTrip'), value: (r) => r.request.tripNumber },
      { header: t('transporter.export.baleCount'), value: (r) => r.request.tripBaleCount },
      {
        header: t('transporter.export.loadingCompletedAt'),
        value: (r) => fmtDateTime(r.request.tripLoadingCompletedAt),
      },
      {
        header: t('transporter.export.arrivalCmrAt'),
        value: (r) => fmtDateTime(r.request.tripSignedAt),
      },
      {
        header: t('transporter.export.completedAt'),
        value: (r) => fmtDateTime(r.request.tripCompletedAt),
      },
      { header: t('transporter.export.createdAt'), value: (r) => fmtDateTime(r.request.createdAt) },
      { header: t('transporter.export.confirmedBy'), value: (r) => r.request.confirmedByName },
      {
        header: t('transporter.export.cancelledAt'),
        value: (r) => fmtDateTime(r.request.cancelledAt),
      },
      {
        header: t('transporter.export.cancellationReason'),
        value: (r) => r.request.cancellationReason,
      },
      { header: t('transporter.export.hasAviz'), value: (r) => yesNo(r.request.hasAviz) },
      { header: t('transporter.export.hasCmrScan'), value: (r) => yesNo(r.request.hasCmrScan) },
      {
        header: t('transporter.export.hasCmrArrival'),
        value: (r) => yesNo(r.request.hasCmrArrival),
      },
      { header: t('transporter.export.hasComanda'), value: (r) => yesNo(r.request.hasComanda) },
      { header: t('transporter.export.comandaOrderNo'), value: (r) => r.request.comandaOrderNo },
    ];
    void exportXlsx(
      `curse-${slug}-${romaniaDateString()}.xlsx`,
      t('transporter.myTripsTitle'),
      columns,
      rows,
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('transporter.myTripsTitle')}
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t('transporter.exportXlsx')}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('transporter.searchPlaceholder')}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={inputCls}
          aria-label={t('fuelLogs.dateFrom')}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={inputCls}
          aria-label={t('trips.dateTo')}
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className={inputCls}
          aria-label={t('tripRequests.colStatus')}
        >
          <option value="">{t('trips.stageAll')}</option>
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`tripRequests.stage.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {isError ? (
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-400">
          {t('tripRequests.loadError')}
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <AuxTripTable
          rows={rows}
          readOnly
          onRowClick={(row) => setDetailsTarget(row.request)}
          onUploadAviz={(r) => setAvizTarget(r)}
          onUploadCmr={(r) => setCmrTarget(r)}
          onUploadCmrArrival={(r) => setCmrArrivalTarget(r)}
          onViewComanda={(r) => setComandaTarget(r)}
          onDelete={(row) => setDeleteTarget(row.request)}
          emptyMessage={t('transporter.empty')}
        />
      )}

      {detailsTarget && (
        <RequestDetailsModal request={detailsTarget} onClose={() => setDetailsTarget(null)} />
      )}
      {avizTarget && (
        <AvizUploadModal
          request={avizTarget}
          variant="transporter"
          onClose={() => setAvizTarget(null)}
        />
      )}
      {cmrTarget && (
        <CmrUploadModal
          request={cmrTarget}
          variant="transporter"
          onClose={() => setCmrTarget(null)}
        />
      )}
      {cmrArrivalTarget && (
        <CmrUploadModal
          request={cmrArrivalTarget}
          variant="transporter"
          kind="delivery"
          onClose={() => setCmrArrivalTarget(null)}
        />
      )}
      {comandaTarget && (
        <ComandaModal request={comandaTarget} onClose={() => setComandaTarget(null)} />
      )}
      {deleteTarget && (
        <TransporterDeleteTripDialog request={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}

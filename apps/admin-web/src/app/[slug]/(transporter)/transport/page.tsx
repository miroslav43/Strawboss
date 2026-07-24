'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTransporterRequests } from '@strawboss/api';
import type { TripRequest } from '@strawboss/types';
import { AUX_STAGE_ORDER } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { buildAuxRows } from '@/lib/aux-rows';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { AuxTripTable } from '@/components/features/trips/AuxTripTable';
import { RequestDetailsModal } from '@/components/features/trip-requests/RequestDetailsModal';

const inputCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// All stages, pending INCLUDED: the transporter has no intake strip, so a
// just-submitted (still-pending) request must be visible in their own ledger.
const STAGE_OPTIONS = AUX_STAGE_ORDER;

/**
 * The transporter's read-only ledger — the aux transports THEY created, rendered
 * through the same AuxStage lifecycle the admin ledger uses (buildAuxRows +
 * AuxTripTable in `readOnly` mode: no confirm/cancel/unplan/upload). Row click
 * opens the read-only details modal.
 */
export default function TransporterTripsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [detailsTarget, setDetailsTarget] = useState<TripRequest | null>(null);

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

  return (
    <div className="space-y-4">
      <PageHeader title={t('transporter.myTripsTitle')} />

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
          emptyMessage={t('transporter.empty')}
        />
      )}

      {detailsTarget && (
        <RequestDetailsModal request={detailsTarget} onClose={() => setDetailsTarget(null)} />
      )}
    </div>
  );
}

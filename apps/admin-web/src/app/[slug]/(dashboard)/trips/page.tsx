'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo } from 'react';
import { useTrips } from '@strawboss/api';
import { TripStatus } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { TripList, type TripRow } from '@/components/features/trips/TripList';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';

export default function TripsPage() {
  const { t } = useI18n();

  // W26: use trips.status.* i18n keys instead of raw string replace
  const statusOptions = useMemo(
    () => [
      { value: '', label: t('trips.allStatuses') },
      ...Object.values(TripStatus).map((s) => ({
        value: s,
        label: t(`trips.status.${s}`),
      })),
    ],
    [t],
  );

  // W12: search state fed through SearchInput (debounce is inside SearchInput)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters: Record<string, string> = {};
  if (statusFilter) filters.status = statusFilter;
  if (search) filters.search = search;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;

  const hasFilters = Object.keys(filters).length > 0;
  const tripsQuery = useTrips(apiClient, hasFilters ? filters : undefined);
  // Backend returns a raw snake_case array; normalize + expose as TripRow[]
  // so the table can display labels without any camelCase assumptions.
  const trips = useMemo<TripRow[]>(
    () => normalizeList<TripRow>(tripsQuery.data),
    [tripsQuery.data],
  );

  return (
    <div>
      <PageHeader title={t('trips.title')} />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search — SearchInput has 300 ms debounce built-in */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('trips.searchPlaceholder')}
        />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Date range */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-neutral-400">{t('fuelLogs.dateTo').toLowerCase()}</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Trip list */}
      {tripsQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading')}</div>
      ) : tripsQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('trips.loadError')}</div>
      ) : (
        <TripList trips={trips} />
      )}
    </div>
  );
}

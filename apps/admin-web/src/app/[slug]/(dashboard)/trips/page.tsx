'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo } from 'react';
import { Truck } from 'lucide-react';
import { useTrips } from '@strawboss/api';
import { TripStatus, type Trip } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { TripList } from '@/components/features/trips/TripList';
import { AuxTripSection } from '@/components/features/trips/AuxTripSection';
import { SearchInput } from '@/components/shared/SearchInput';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useIsDispatcher } from '@/hooks/useIsDispatcher';
import { normalizeList } from '@/lib/normalize-api-list';
import { toTripCamelList } from '@/lib/trip-mapper';

const inputCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * "Curse" — one page, two delimited ledgers.
 *
 * TOP: auxiliary transports (external transporters). Anchored on the REQUEST,
 * which is where an aux transport is born and where all of its commercial facts
 * live; its trip is attached server-side once a dispatcher materializes one.
 *
 * BOTTOM: own-fleet trips, `isAuxiliary=false`.
 *
 * They are NOT one table. The two entities have opposite directions of goods flow
 * (fleet: field → our depot; aux: our depot → the customer's yard), different
 * lifecycles (the aux one is collapsed: planned → loaded → completed, no
 * depart/arrive/deliver) and disjoint status vocabularies. Rendering both through
 * one own-fleet-shaped column set is exactly what produced the half-empty rows
 * this page was merged to fix.
 *
 * TWO independent server-scoped queries, never a client-side split of one fetch:
 * a single `LIMIT 1000` of mixed rows would let a busy fleet starve the aux table
 * of rows entirely.
 */
export default function TripsPage() {
  const { t } = useI18n();
  const isDispatcher = useIsDispatcher();

  // Shared across both ledgers.
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Owned by the fleet ledger — never merged with the aux stage select. The two
  // vocabularies are disjoint, and picking `in_transit` on a shared dropdown
  // would permanently empty the aux table (an aux trip cannot reach it).
  const [statusFilter, setStatusFilter] = useState('');

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('trips.allStatuses') },
      ...Object.values(TripStatus).map((s) => ({ value: s, label: t(`trips.status.${s}`) })),
    ],
    [t],
  );

  const tripFilters = useMemo(() => {
    // `isAuxiliary` is always sent: this ledger is the OWN-FLEET one, and the
    // filter is what keeps an aux trip — with its structurally-blank driver and
    // parcel — from ever appearing here again.
    const f: Record<string, string> = { isAuxiliary: 'false' };
    if (statusFilter) f.status = statusFilter;
    if (search) f.search = search;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    return f;
  }, [statusFilter, search, dateFrom, dateTo]);

  const tripsQuery = useTrips(apiClient, tripFilters);
  const trips = useMemo<Trip[]>(
    () => toTripCamelList(normalizeList(tripsQuery.data)),
    [tripsQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('trips.title')} />

      {/* One global filter bar. Each ledger keeps its own status select. */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('trips.searchPlaceholder')}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={inputCls}
          aria-label={t('fuelLogs.dateFrom')}
        />
        <span className="text-xs text-neutral-400">{t('trips.dateTo')}</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={inputCls}
          aria-label={t('trips.dateTo')}
        />
      </div>

      {/* Auxiliary ledger — admin/dispatcher only. GET /trip-requests is
          @Roles(admin, dispatcher); not mounting this means an operator who signs
          in on the web never fires the query and never sees a 403 panel. */}
      {isDispatcher && <AuxTripSection search={search} dateFrom={dateFrom} dateTo={dateTo} />}

      {/* Own-fleet ledger. */}
      <section id="fleet" className="space-y-3">
        <SectionHeader
          title={t('trips.sectionNormal')}
          hint={t('trips.sectionNormalHint')}
          count={trips.length}
          icon={Truck}
          actions={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={inputCls}
              aria-label={t('trips_list.colStatus')}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          }
        />

        {tripsQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading')}</div>
        ) : tripsQuery.isError ? (
          <div className="py-8 text-center text-sm text-red-500">{t('trips.loadError')}</div>
        ) : (
          <TripList trips={trips} canDelete={isDispatcher} emptyMessage={t('trips.normalEmpty')} />
        )}
      </section>
    </div>
  );
}

'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useTrips } from '@strawboss/api';
import { TripStatus } from '@strawboss/types';
import type { Trip, PaginatedResponse } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { TripList } from '@/components/features/trips/TripList';
import { apiClient } from '@/lib/api';

const statusOptions: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  ...Object.values(TripStatus).map((s) => ({
    value: s,
    label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  })),
];

export default function TripsPage() {
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
  const tripsResponse = tripsQuery.data as PaginatedResponse<Trip> | undefined;
  const trips = tripsResponse?.data ?? [];

  return (
    <div>
      <PageHeader title="Trips" />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search trip number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

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
          placeholder="From"
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-neutral-400">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          placeholder="To"
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Trip list */}
      {tripsQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          Loading trips...
        </div>
      ) : tripsQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          Failed to load trips. The backend may not be running.
        </div>
      ) : (
        <TripList trips={trips} />
      )}
    </div>
  );
}

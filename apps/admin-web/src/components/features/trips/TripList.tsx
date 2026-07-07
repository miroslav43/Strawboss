'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import type { Trip } from '@strawboss/types';
import { useDeleteTrip } from '@strawboss/api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { apiClient } from '@/lib/api';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useI18n } from '@/lib/i18n';

/**
 * Shape of a single trip row as returned by `GET /api/v1/trips`.
 * The backend emits snake_case; the enrichment JOIN also provides
 * human-readable labels for truck / driver / parcel / destination.
 *
 * Fields are optional so the table degrades gracefully if the JOIN
 * misses a foreign key (e.g. a trip without driver yet).
 */
export interface TripRow extends Record<string, unknown> {
  id: string;
  trip_number: string | null;
  status: Trip['status'];
  truck_id: string | null;
  driver_id: string | null;
  source_parcel_id: string | null;
  destination_id: string | null;
  bale_count: number | string | null;
  created_at: string;
  // JOIN-enriched labels
  destination_name?: string | null;
  truck_plate?: string | null;
  truck_code?: string | null;
  driver_name?: string | null;
  source_parcel_name?: string | null;
  source_parcel_code?: string | null;
}

function truckLabel(row: TripRow): string {
  return row.truck_plate || row.truck_code || (row.truck_id ? `${row.truck_id.slice(0, 8)}…` : '—');
}

function driverLabel(row: TripRow): string {
  if (row.driver_name && row.driver_name.trim().length > 0) return row.driver_name;
  return row.driver_id ? `${row.driver_id.slice(0, 8)}…` : '—';
}

function sourceLabel(row: TripRow): string {
  return (
    row.source_parcel_name ||
    row.source_parcel_code ||
    (row.source_parcel_id ? `${row.source_parcel_id.slice(0, 8)}…` : '—')
  );
}

type TFunc = (key: string) => string;

function buildColumns(t: TFunc): Column<TripRow>[] {
  return [
    {
      key: 'trip_number',
      header: t('trips_list.colTripNumber'),
      sortable: true,
      render: (row) => (
        <span className="font-medium text-neutral-800">{row.trip_number ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('trips_list.colStatus'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'truck_plate',
      header: t('trips_list.colTruck'),
      render: (row) => <span className="text-xs text-neutral-700">{truckLabel(row)}</span>,
    },
    {
      key: 'driver_name',
      header: t('trips_list.colDriver'),
      render: (row) => <span className="text-xs text-neutral-700">{driverLabel(row)}</span>,
    },
    {
      key: 'source_parcel_name',
      header: t('trips_list.colSource'),
      render: (row) => <span className="text-xs text-neutral-700">{sourceLabel(row)}</span>,
    },
    {
      key: 'destination_name',
      header: t('trips_list.colDestination'),
      render: (row) => (
        <span className="text-xs text-neutral-700">{row.destination_name ?? '—'}</span>
      ),
    },
    {
      key: 'bale_count',
      header: t('trips_list.colBales'),
      sortable: true,
      render: (row) => <span>{Number(row.bale_count ?? 0)}</span>,
    },
    {
      key: 'created_at',
      header: t('trips_list.colCreated'),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-neutral-500">
          {new Date(String(row.created_at)).toLocaleDateString()}
        </span>
      ),
    },
  ];
}

interface TripListProps {
  trips: TripRow[];
}

export function TripList({ trips }: TripListProps) {
  const router = useRouter();
  const slug = useOrgSlug();
  const { t } = useI18n();
  const deleteTrip = useDeleteTrip(apiClient);

  const columns: Column<TripRow>[] = [
    ...buildColumns(t),
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            // Don't trigger row click when tapping trash
            e.stopPropagation();
            const label = row.trip_number ?? row.id.slice(0, 8);
            if (
              typeof window !== 'undefined' &&
              window.confirm(t('trips_list.deleteConfirm', { label }))
            ) {
              deleteTrip.mutate(row.id);
            }
          }}
          className="rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
          aria-label={t('trips_list.deleteAriaLabel')}
          title={t('trips_list.deleteAriaLabel')}
          disabled={deleteTrip.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <DataTable<TripRow>
      columns={columns}
      data={trips}
      keyExtractor={(row) => row.id}
      onRowClick={(row) => router.push(`/${slug}/trips/${row.id}`)}
    />
  );
}

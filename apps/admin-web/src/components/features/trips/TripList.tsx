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
import { fmtDateTime, EMPTY } from '@/lib/date';
import { driverLabel, sourceLabel, truckLabel, baleLabel, hasBaleShortfall } from './trip-labels';
import { cn } from '@/lib/utils';

/**
 * `Trip` is an interface with no index signature, so it cannot satisfy
 * DataTable's `<T extends Record<string, unknown>>` constraint directly. This
 * alias adds the signature without copying the shape — the previous approach
 * (a hand-rolled snake_case `TripRow`) drifted from the real row and is what
 * hid `externalDriverName` / `isAuxiliary` from the table.
 */
type TripRow = Trip & Record<string, unknown>;

type TFunc = (key: string) => string;

function buildColumns(t: TFunc): Column<TripRow>[] {
  return [
    {
      key: 'tripNumber',
      header: t('trips_list.colTripNumber'),
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-1.5 font-medium text-neutral-800">
          {row.tripNumber || EMPTY}
          {row.iterationIndex > 1 && (
            <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold text-neutral-500">
              #{row.iterationIndex}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('trips_list.colStatus'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'truckPlate',
      header: t('trips_list.colTruck'),
      render: (row) => <span className="text-xs text-neutral-700">{truckLabel(row)}</span>,
    },
    {
      key: 'driverName',
      header: t('trips_list.colDriver'),
      render: (row) => <span className="text-xs text-neutral-700">{driverLabel(row)}</span>,
    },
    {
      key: 'sourceParcelName',
      header: t('trips_list.colSource'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-neutral-700">{sourceLabel(row)}</p>
          {row.sourceFarmName && (
            <p className="truncate text-[11px] text-neutral-400">{row.sourceFarmName}</p>
          )}
        </div>
      ),
    },
    {
      key: 'destinationName',
      header: t('trips_list.colDestination'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-neutral-700">{row.destinationName ?? EMPTY}</p>
          {row.destinationAddress && (
            <p className="truncate text-[11px] text-neutral-400">{row.destinationAddress}</p>
          )}
        </div>
      ),
    },
    {
      key: 'baleCount',
      header: t('trips_list.colBales'),
      sortable: true,
      render: (row) => (
        <span className={cn('tabular-nums', hasBaleShortfall(row) && 'font-medium text-red-600')}>
          {baleLabel(row)}
        </span>
      ),
    },
    {
      key: 'netWeightKg',
      header: t('trips_list.colNetWeight'),
      sortable: true,
      render: (row) => (
        <span className="tabular-nums text-xs text-neutral-700">
          {row.netWeightKg != null ? `${row.netWeightKg} kg` : EMPTY}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('trips_list.colCreated'),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-neutral-500">{fmtDateTime(row.createdAt)}</span>
      ),
    },
  ];
}

interface TripListProps {
  trips: Trip[];
  /**
   * Render the delete action. DELETE /trips/:id is `@Roles(admin, dispatcher)`,
   * so for any other role the button would render and then 403 on click.
   */
  canDelete?: boolean;
  emptyMessage?: string;
}

export function TripList({ trips, canDelete = false, emptyMessage }: TripListProps) {
  const router = useRouter();
  const slug = useOrgSlug();
  const { t } = useI18n();
  const deleteTrip = useDeleteTrip(apiClient);

  const rows = trips as TripRow[];

  const columns: Column<TripRow>[] = [
    ...buildColumns(t),
    ...(canDelete
      ? [
          {
            key: 'actions',
            header: '',
            render: (row: TripRow) => (
              <button
                type="button"
                onClick={(e) => {
                  // Don't trigger row click when tapping trash
                  e.stopPropagation();
                  const label = row.tripNumber || row.id.slice(0, 8);
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
        ]
      : []),
  ];

  return (
    <DataTable<TripRow>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      onRowClick={(row) => router.push(`/${slug}/trips/${row.id}`)}
      emptyMessage={emptyMessage}
    />
  );
}

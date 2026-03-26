'use client';

import { useRouter } from 'next/navigation';
import type { Trip } from '@strawboss/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable, type Column } from '@/components/shared/DataTable';

interface TripRow extends Record<string, unknown> {
  id: string;
  tripNumber: string;
  status: Trip['status'];
  truckId: string;
  driverId: string;
  sourceParcelId: string;
  destinationName: string | null;
  baleCount: number;
  createdAt: string;
}

function toRow(trip: Trip): TripRow {
  return {
    id: trip.id,
    tripNumber: trip.tripNumber,
    status: trip.status,
    truckId: trip.truckId,
    driverId: trip.driverId,
    sourceParcelId: trip.sourceParcelId,
    destinationName: trip.destinationName,
    baleCount: trip.baleCount,
    createdAt: trip.createdAt,
  };
}

const columns: Column<TripRow>[] = [
  {
    key: 'tripNumber',
    header: 'Trip #',
    sortable: true,
    render: (row) => (
      <span className="font-medium text-neutral-800">{row.tripNumber}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'truckId',
    header: 'Truck',
    render: (row) => (
      <span className="text-xs text-neutral-600">
        {String(row.truckId).slice(0, 8)}...
      </span>
    ),
  },
  {
    key: 'driverId',
    header: 'Driver',
    render: (row) => (
      <span className="text-xs text-neutral-600">
        {String(row.driverId).slice(0, 8)}...
      </span>
    ),
  },
  {
    key: 'sourceParcelId',
    header: 'Source',
    render: (row) => (
      <span className="text-xs text-neutral-600">
        {String(row.sourceParcelId).slice(0, 8)}...
      </span>
    ),
  },
  {
    key: 'destinationName',
    header: 'Destination',
    render: (row) => (
      <span className="text-xs text-neutral-600">
        {row.destinationName ?? 'TBD'}
      </span>
    ),
  },
  {
    key: 'baleCount',
    header: 'Bales',
    sortable: true,
  },
  {
    key: 'createdAt',
    header: 'Created',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-neutral-500">
        {new Date(String(row.createdAt)).toLocaleDateString()}
      </span>
    ),
  },
];

interface TripListProps {
  trips: Trip[];
}

export function TripList({ trips }: TripListProps) {
  const router = useRouter();
  const rows = trips.map(toRow);

  return (
    <DataTable<TripRow>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      onRowClick={(row) => router.push(`/trips/${row.id}`)}
    />
  );
}

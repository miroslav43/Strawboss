'use client';
export const dynamic = 'force-dynamic';

import { Truck, Package, Cog, AlertTriangle } from 'lucide-react';
import { useDashboardOverview, useTrips } from '@strawboss/api';
import type { Trip, DashboardOverview, PaginatedResponse } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { OperationStatusGrid } from '@/components/features/operations/OperationStatusGrid';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SummaryCardProps {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}

function SummaryCard({ title, value, icon: Icon, color }: SummaryCardProps) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            {title}
          </p>
          <p className="mt-1 text-2xl font-bold text-neutral-800">{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', color)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function OperationsPage() {
  const overviewQuery = useDashboardOverview(apiClient);
  // "Active" = all in-progress states; trip_status has no 'active' value
  const tripsQuery = useTrips(apiClient, { status: 'planned,loading,loaded,in_transit,arrived,delivering' });

  const overview: DashboardOverview | undefined = overviewQuery.data;
  const tripsResponse = tripsQuery.data as PaginatedResponse<Trip> | undefined;
  const trips = tripsResponse?.data ?? [];

  return (
    <div>
      <PageHeader title="Operations" />

      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Active Trips"
          value={overview?.activeTrips ?? '--'}
          icon={Truck}
          color="bg-blue-100 text-blue-600"
        />
        <SummaryCard
          title="Bales Today"
          value={overview?.balesToday ?? '--'}
          icon={Package}
          color="bg-green-100 text-green-600"
        />
        <SummaryCard
          title="Active Machines"
          value={overview?.activeMachines ?? '--'}
          icon={Cog}
          color="bg-amber-100 text-amber-600"
        />
        <SummaryCard
          title="Pending Alerts"
          value={overview?.pendingAlerts ?? '--'}
          icon={AlertTriangle}
          color="bg-red-100 text-red-600"
        />
      </div>

      {/* Active trips grid */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-neutral-800">
          Active Trips
        </h2>
        {tripsQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            Loading trips...
          </div>
        ) : tripsQuery.isError ? (
          <div className="py-8 text-center text-sm text-red-500">
            Failed to load trips. The backend may not be running.
          </div>
        ) : (
          <OperationStatusGrid trips={trips} />
        )}
      </div>
    </div>
  );
}

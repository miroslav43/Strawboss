'use client';
export const dynamic = 'force-dynamic';

import {
  useDashboardOverview,
  useDashboardTrending,
  useBaleProductionStats,
  useTrips,
} from '@strawboss/api';
import type {
  DashboardOverview,
  Trip,
  PaginatedResponse,
} from '@strawboss/types';
import type { TrendingDay } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { TrendingChart } from '@/components/features/dashboard/TrendingChart';
import { TopOperators } from '@/components/features/dashboard/TopOperators';
import type { OperatorStat } from '@/components/features/dashboard/TopOperators';
import { RecentTrips } from '@/components/features/dashboard/RecentTrips';
import { apiClient } from '@/lib/api';

export default function DashboardPage() {
  const today = new Date().toISOString().slice(0, 10);

  const overviewQuery = useDashboardOverview(apiClient);
  const trendingQuery = useDashboardTrending(apiClient);
  const operatorStatsQuery = useBaleProductionStats(apiClient, {
    dateFrom: today,
    groupBy: 'operator',
  });
  const tripsQuery = useTrips(apiClient, { limit: '5', sort: '-createdAt' });

  const overview: DashboardOverview | undefined = overviewQuery.data;
  const trending: TrendingDay[] = trendingQuery.data ?? [];
  const operatorStats: OperatorStat[] = (operatorStatsQuery.data ?? []) as OperatorStat[];
  const tripsResponse = tripsQuery.data as PaginatedResponse<Trip> | undefined;
  const trips: Trip[] = tripsResponse?.data ?? [];

  const isLoading =
    overviewQuery.isLoading ||
    trendingQuery.isLoading ||
    operatorStatsQuery.isLoading ||
    tripsQuery.isLoading;

  return (
    <div>
      <PageHeader title="Dashboard" />

      {isLoading && (
        <div className="py-8 text-center text-sm text-neutral-400">
          Se incarca datele...
        </div>
      )}

      {/* Row 1: KPI Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={'\uD83C\uDF3E'}
          label="Baloti azi"
          value={overview?.balesToday ?? '--'}
          subtitle={`${overview?.tripsCompleted ?? 0} curse finalizate`}
        />
        <KpiCard
          icon={'\uD83D\uDE9A'}
          label="Curse active"
          value={overview?.activeTrips ?? '--'}
          subtitle={`${overview?.tripsToday ?? 0} total azi`}
        />
        <KpiCard
          icon={'\u2699\uFE0F'}
          label="Masini active"
          value={overview?.activeMachines ?? '--'}
        />
        <KpiCard
          icon={'\uD83D\uDD14'}
          label="Alerte noi"
          value={overview?.pendingAlerts ?? '--'}
        />
      </div>

      {/* Row 2: Trending chart */}
      <div className="mb-6">
        <TrendingChart data={trending} />
      </div>

      {/* Row 3: Top operators + Recent trips */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TopOperators data={operatorStats} />
        <RecentTrips trips={trips} />
      </div>
    </div>
  );
}

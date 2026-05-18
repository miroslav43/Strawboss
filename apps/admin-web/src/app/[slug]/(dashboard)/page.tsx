'use client';
export const dynamic = 'force-dynamic';

import {
  useDashboardOverview,
  useDashboardTrending,
  useBaleProductionStats,
  useTrips,
} from '@strawboss/api';
import type { Trip } from '@strawboss/types';
import type { TrendingDay } from '@strawboss/api';
import { Wheat, Truck, Cog, Bell } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { TrendingChart } from '@/components/features/dashboard/TrendingChart';
import { TopOperators } from '@/components/features/dashboard/TopOperators';
import type { OperatorStat } from '@/components/features/dashboard/TopOperators';
import { RecentTrips } from '@/components/features/dashboard/RecentTrips';
import { apiClient } from '@/lib/api';
import { todayInRomania } from '@/lib/date';
import { normalizeList } from '@/lib/normalize-api-list';
import { useI18n } from '@/lib/i18n';

export default function DashboardPage() {
  const { t } = useI18n();
  const today = todayInRomania();

  const overviewQuery = useDashboardOverview(apiClient);
  const trendingQuery = useDashboardTrending(apiClient);
  const operatorStatsQuery = useBaleProductionStats(apiClient, {
    dateFrom: today,
    groupBy: 'operator',
  });
  const tripsQuery = useTrips(apiClient, { limit: '5', sort: '-createdAt' });

  const overview = overviewQuery.data;
  const trending: TrendingDay[] = trendingQuery.data ?? [];
  const operatorStats: OperatorStat[] = (operatorStatsQuery.data ?? []) as OperatorStat[];
  // W14: use normalizeList so both array and {data:[]} shapes are handled
  const trips: Trip[] = normalizeList<Trip>(tripsQuery.data);

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />

      {/* Row 1: KPI Cards — W20: lucide icons, W21: per-card skeletons */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overviewQuery.isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              icon={Wheat}
              label={t('dashboard.balesToday')}
              value={overview?.balesToday ?? '--'}
              subtitle={t('dashboard.tripsCompleted', { count: overview?.tripsCompleted ?? 0 })}
            />
            <KpiCard
              icon={Truck}
              label={t('dashboard.activeTrips')}
              value={overview?.activeTrips ?? '--'}
              subtitle={t('dashboard.tripsToday', { count: overview?.tripsToday ?? 0 })}
            />
            <KpiCard
              icon={Cog}
              label={t('dashboard.activeMachines')}
              value={overview?.activeMachines ?? '--'}
            />
            <KpiCard
              icon={Bell}
              label={t('dashboard.newAlerts')}
              value={overview?.pendingAlerts ?? '--'}
            />
          </>
        )}
      </div>

      {/* Row 2: Trending chart — W21: skeleton while loading */}
      <div className="mb-6">
        {trendingQuery.isLoading ? (
          <div className="h-48 animate-pulse rounded-xl bg-neutral-100" />
        ) : (
          <TrendingChart data={trending} />
        )}
      </div>

      {/* Row 3: Top operators + Recent trips — W21: per-section skeletons */}
      <div className="grid gap-6 lg:grid-cols-2">
        {operatorStatsQuery.isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
        ) : (
          <TopOperators data={operatorStats} />
        )}
        {tripsQuery.isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
        ) : (
          <RecentTrips trips={trips} />
        )}
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return <div className="h-28 animate-pulse rounded-xl bg-neutral-100" />;
}

'use client';

import type { DepotReport, FarmReport } from '@strawboss/types';
import { RankingBarChart, type RankingDatum } from './RankingBarChart';
import { useI18n } from '@/lib/i18n';

interface RankingsTabProps {
  farms: FarmReport[];
  depots: DepotReport[];
  isLoading: boolean;
  isError: boolean;
}

const TOP_N = 8;

function topBy<T>(
  items: T[],
  metric: (item: T) => number,
  name: (item: T) => string,
): RankingDatum[] {
  return items
    .filter((item) => metric(item) > 0)
    .sort((a, b) => metric(b) - metric(a))
    .slice(0, TOP_N)
    .map((item) => ({ name: name(item), value: metric(item) }));
}

function RankingSection({
  title,
  data,
  color,
}: {
  title: string;
  data: RankingDatum[];
  color: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-800">{title}</h3>
      <RankingBarChart data={data} color={color} />
    </div>
  );
}

export function RankingsTab({
  farms,
  depots,
  isLoading,
  isError,
}: RankingsTabProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.common.loading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-red-500">
        {t('reports.common.error')}
      </div>
    );
  }

  const topProduced = topBy(
    farms,
    (f) => f.produced,
    (f) => f.farmName,
  );
  const topDelivered = topBy(
    farms,
    (f) => f.delivered,
    (f) => f.farmName,
  );
  const busiestDepots = topBy(
    depots,
    (d) => d.deliveryCount,
    (d) => d.depotName,
  );

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-neutral-800">
        {t('reports.rankings.heading')}
      </h2>
      <RankingSection
        title={t('reports.rankings.topFarmsByProduced')}
        data={topProduced}
        color="#4f7942"
      />
      <RankingSection
        title={t('reports.rankings.topFarmsByDelivered')}
        data={topDelivered}
        color="#f59e0b"
      />
      <RankingSection
        title={t('reports.rankings.busiestDepots')}
        data={busiestDepots}
        color="#3b82f6"
      />
    </div>
  );
}

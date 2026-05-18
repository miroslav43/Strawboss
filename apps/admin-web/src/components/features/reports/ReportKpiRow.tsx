'use client';

import { Wheat, Package, CheckCircle2, Warehouse, TrendingDown } from 'lucide-react';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { useI18n } from '@/lib/i18n';

interface ReportKpiRowProps {
  produced: number;
  loaded: number;
  delivered: number;
  depotStock: number;
  lossPercentage: number;
}

/** Always-visible KPI summary above the report tabs. */
export function ReportKpiRow({
  produced,
  loaded,
  delivered,
  depotStock,
  lossPercentage,
}: ReportKpiRowProps) {
  const { t } = useI18n();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard icon={Wheat} label={t('reports.kpi.produced')} value={produced.toLocaleString()} />
      <KpiCard icon={Package} label={t('reports.kpi.loaded')} value={loaded.toLocaleString()} />
      <KpiCard
        icon={CheckCircle2}
        label={t('reports.kpi.delivered')}
        value={delivered.toLocaleString()}
      />
      <KpiCard
        icon={Warehouse}
        label={t('reports.kpi.depotStock')}
        value={depotStock.toLocaleString()}
      />
      <KpiCard
        icon={TrendingDown}
        label={t('reports.kpi.loss')}
        value={`${lossPercentage.toFixed(1)}%`}
      />
    </div>
  );
}

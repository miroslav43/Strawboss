'use client';
export const dynamic = 'force-dynamic';

import { useState, useCallback } from 'react';
import { Download, FileText } from 'lucide-react';
import {
  useFarmReports,
  useDepotReports,
  useReportTimeline,
  useCostReport,
  useBaleProductionStats,
} from '@strawboss/api';
import type { FarmReport, DepotReport, ReportTimelinePoint, CostReport } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportFilters } from '@/components/features/reports/ReportFilters';
import { ReportKpiRow } from '@/components/features/reports/ReportKpiRow';
import { FarmReportTab } from '@/components/features/reports/FarmReportTab';
import { DepotReportTab } from '@/components/features/reports/DepotReportTab';
import { RankingsTab } from '@/components/features/reports/RankingsTab';
import { CostBreakdownChart } from '@/components/features/reports/CostBreakdownChart';
import { OperatorProductionChart } from '@/components/features/reports/OperatorProductionChart';
import type { OperatorProductionRow } from '@/components/features/reports/OperatorProductionChart';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { exportCsv } from '@/lib/csv';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

type Tab = 'farms' | 'depots' | 'rankings' | 'costs' | 'operators';

const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'farms', labelKey: 'reports.tabs.farms' },
  { id: 'depots', labelKey: 'reports.tabs.depots' },
  { id: 'rankings', labelKey: 'reports.tabs.rankings' },
  { id: 'costs', labelKey: 'reports.tabs.costs' },
  { id: 'operators', labelKey: 'reports.tabs.operators' },
];

interface CostRow extends Record<string, unknown> {
  entityId: string;
  entityName: string;
  entityType: string;
  fuelCost: number;
  consumableCost: number;
  totalCost: number;
}

interface OperatorRow extends Record<string, unknown> {
  operatorId: string;
  operatorName: string;
  parcelCount: number;
  totalBales: number;
  sessionCount: number;
  avgPerSession: number;
}

function ExportCsvButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('farms');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters: Record<string, string> = {};
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  const hasFilters = Object.keys(filters).length > 0;
  const activeFilters = hasFilters ? filters : undefined;

  // W17: each query only runs when its tab is active (or when farms/depots/rankings share data)
  const isFarmsOrRankings = tab === 'farms' || tab === 'rankings';
  const isDepotsOrRankings = tab === 'depots' || tab === 'rankings';

  const farmQuery = useFarmReports(apiClient, activeFilters, {
    enabled: isFarmsOrRankings,
  });
  const depotQuery = useDepotReports(apiClient, activeFilters, {
    enabled: isDepotsOrRankings,
  });
  const timelineQuery = useReportTimeline(apiClient, activeFilters, {
    enabled: tab === 'farms',
  });
  const costQuery = useCostReport(apiClient, activeFilters, {
    enabled: tab === 'costs',
  });
  const operatorStatsQuery = useBaleProductionStats(
    apiClient,
    {
      ...(hasFilters ? filters : {}),
      groupBy: 'operator',
    },
    { enabled: tab === 'operators' },
  );

  const farms: FarmReport[] = farmQuery.data ?? [];
  const depots: DepotReport[] = depotQuery.data ?? [];
  const timeline: ReportTimelinePoint[] = timelineQuery.data ?? [];
  const costs: CostReport[] = costQuery.data ?? [];
  const operatorStatsRaw: OperatorProductionRow[] = (operatorStatsQuery.data ??
    []) as OperatorProductionRow[];

  // KPI summary — computed client-side from the farm + depot reports.
  const totalProduced = farms.reduce((s, f) => s + f.produced, 0);
  const totalLoaded = farms.reduce((s, f) => s + f.loaded, 0);
  const totalDelivered = farms.reduce((s, f) => s + f.delivered, 0);
  const totalDepotStock = depots.reduce((s, d) => s + d.totalStock, 0);
  const lossPercentage =
    totalProduced > 0 ? ((totalProduced - totalDelivered) / totalProduced) * 100 : 0;

  const costRows: CostRow[] = costs.map((c) => ({ ...c }) as CostRow);
  const operatorRows: OperatorRow[] = operatorStatsRaw.map((o) => {
    const totalBales = Number(o.totalBales) || 0;
    const sessionCount = Number(o.sessionCount) || 0;
    return {
      operatorId: String(o.operatorId ?? ''),
      operatorName: String(o.operatorName ?? 'N/A'),
      parcelCount: Number(o.parcelCount) || 0,
      totalBales,
      sessionCount,
      avgPerSession: sessionCount > 0 ? totalBales / sessionCount : 0,
    };
  });

  const costColumns: Column<CostRow>[] = [
    {
      key: 'entityName',
      header: t('reports.costs.entity'),
      sortable: true,
      render: (row) => <span className="font-medium text-neutral-800">{row.entityName}</span>,
    },
    {
      key: 'entityType',
      header: t('reports.costs.type'),
      render: (row) => (
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
          {String(row.entityType)}
        </span>
      ),
    },
    {
      key: 'fuelCost',
      header: t('reports.costs.fuelCost'),
      sortable: true,
      render: (row) => `$${row.fuelCost.toLocaleString()}`,
    },
    {
      key: 'consumableCost',
      header: t('reports.costs.consumableCost'),
      sortable: true,
      render: (row) => `$${row.consumableCost.toLocaleString()}`,
    },
    {
      key: 'totalCost',
      header: t('reports.costs.total'),
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-neutral-800">${row.totalCost.toLocaleString()}</span>
      ),
    },
  ];

  const operatorColumns: Column<OperatorRow>[] = [
    {
      key: 'operatorName',
      header: t('reports.operators.operator'),
      sortable: true,
      render: (row) => <span className="font-medium text-neutral-800">{row.operatorName}</span>,
    },
    {
      key: 'parcelCount',
      header: t('reports.operators.parcels'),
      sortable: true,
    },
    {
      key: 'totalBales',
      header: t('reports.operators.totalBales'),
      sortable: true,
    },
    {
      key: 'sessionCount',
      header: t('reports.operators.sessions'),
      sortable: true,
    },
    {
      key: 'avgPerSession',
      header: t('reports.operators.avgPerSession'),
      sortable: true,
      render: (row) => (
        <span className="text-sm font-medium text-neutral-700">
          {Number.isFinite(row.avgPerSession) ? row.avgPerSession.toFixed(1) : '--'}
        </span>
      ),
    },
  ];

  const handleExportCosts = () => {
    exportCsv<CostRow>(
      'costs-report',
      [
        { header: t('reports.costs.entity'), value: (r) => r.entityName },
        { header: t('reports.costs.type'), value: (r) => r.entityType },
        { header: t('reports.costs.fuelCost'), value: (r) => r.fuelCost },
        {
          header: t('reports.costs.consumableCost'),
          value: (r) => r.consumableCost,
        },
        { header: t('reports.costs.total'), value: (r) => r.totalCost },
      ],
      costRows,
    );
  };

  const handleExportOperators = () => {
    exportCsv<OperatorRow>(
      'operators-report',
      [
        {
          header: t('reports.operators.operator'),
          value: (r) => r.operatorName,
        },
        {
          header: t('reports.operators.parcels'),
          value: (r) => r.parcelCount,
        },
        {
          header: t('reports.operators.totalBales'),
          value: (r) => r.totalBales,
        },
        {
          header: t('reports.operators.sessions'),
          value: (r) => r.sessionCount,
        },
        {
          header: t('reports.operators.avgPerSession'),
          value: (r) => r.avgPerSession.toFixed(1),
        },
      ],
      operatorRows,
    );
  };

  const handleExportPdf = useCallback(() => {
    window.print();
  }, []);

  const periodLabel =
    dateFrom || dateTo ? `${dateFrom || '…'} – ${dateTo || '…'}` : new Date().toLocaleDateString();

  return (
    <div>
      {/* ── Print-only report layout ───────────────────────────────────────
          Visible only when window.print() is called. The main UI is hidden
          via @media print in globals.css (print:hidden on the dashboard shell).
      ──────────────────────────────────────────────────────────────────── */}
      <div className="hidden print:block print:text-black">
        <div className="mb-6 border-b pb-4">
          <h1 className="text-2xl font-bold">StrawBoss — {t('reports.title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{periodLabel}</p>
        </div>

        {/* KPI summary */}
        <div className="mb-6 grid grid-cols-5 gap-4">
          {[
            { label: t('reports.kpi.produced'), value: totalProduced },
            { label: t('reports.kpi.loaded'), value: totalLoaded },
            { label: t('reports.kpi.delivered'), value: totalDelivered },
            { label: t('reports.kpi.depotStock'), value: totalDepotStock },
            { label: t('reports.kpi.loss'), value: `${lossPercentage.toFixed(1)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded border p-3 text-center">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-neutral-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Farms table */}
        {farms.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-base font-semibold">{t('reports.farms.heading')}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-neutral-50">
                  <th className="px-2 py-1 text-left">{t('reports.farms.farm')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.farms.produced')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.farms.loaded')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.farms.delivered')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.farms.loss')}</th>
                </tr>
              </thead>
              <tbody>
                {farms.map((f) => {
                  const loss =
                    f.produced > 0
                      ? (((f.produced - f.delivered) / f.produced) * 100).toFixed(1)
                      : '0.0';
                  return (
                    <tr key={f.farmId ?? f.farmName} className="border-b">
                      <td className="px-2 py-1 font-medium">{f.farmName}</td>
                      <td className="px-2 py-1 text-right">{f.produced}</td>
                      <td className="px-2 py-1 text-right">{f.loaded}</td>
                      <td className="px-2 py-1 text-right">{f.delivered}</td>
                      <td className="px-2 py-1 text-right">{loss}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Depots table */}
        {depots.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-base font-semibold">{t('reports.depots.heading')}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-neutral-50">
                  <th className="px-2 py-1 text-left">{t('reports.depots.depot')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.depots.totalStock')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.depots.receivedInPeriod')}</th>
                  <th className="px-2 py-1 text-right">{t('reports.depots.arrivingNow')}</th>
                </tr>
              </thead>
              <tbody>
                {depots.map((d) => (
                  <tr key={d.depotId} className="border-b">
                    <td className="px-2 py-1 font-medium">{d.depotName}</td>
                    <td className="px-2 py-1 text-right">{d.totalStock}</td>
                    <td className="px-2 py-1 text-right">{d.receivedInPeriod}</td>
                    <td className="px-2 py-1 text-right">{d.arrivingNow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-xs text-neutral-400">
          {t('reports.title')} · {new Date().toLocaleString()}
        </p>
      </div>

      {/* ── Screen-only UI (hidden on print) ───────────────────────────── */}
      <div className="print:hidden">
        <PageHeader
          title={t('reports.title')}
          actions={
            <button
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              <FileText className="h-4 w-4" />
              {t('reports.common.exportPdf')}
            </button>
          }
        />

        {/* Filters */}
        <div className="mb-6">
          <ReportFilters
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        </div>

        {/* KPI summary */}
        <div className="mb-6">
          <ReportKpiRow
            produced={totalProduced}
            loaded={totalLoaded}
            delivered={totalDelivered}
            depotStock={totalDepotStock}
            lossPercentage={lossPercentage}
          />
        </div>

        {/* Tab selector */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
          {TABS.map((tabDef) => (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                tab === tabDef.id
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700',
              )}
            >
              {t(tabDef.labelKey)}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'farms' && (
          <FarmReportTab
            farms={farms}
            timeline={timeline}
            isLoading={farmQuery.isLoading || timelineQuery.isLoading}
            isError={farmQuery.isError || timelineQuery.isError}
          />
        )}

        {tab === 'depots' && (
          <DepotReportTab
            depots={depots}
            isLoading={depotQuery.isLoading}
            isError={depotQuery.isError}
          />
        )}

        {tab === 'rankings' && (
          <RankingsTab
            farms={farms}
            depots={depots}
            isLoading={farmQuery.isLoading || depotQuery.isLoading}
            isError={farmQuery.isError || depotQuery.isError}
          />
        )}

        {tab === 'costs' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-800">
                {t('reports.costs.heading')}
              </h2>
              <ExportCsvButton
                label={t('reports.common.exportCsv')}
                onClick={handleExportCosts}
                disabled={costRows.length === 0}
              />
            </div>
            {costQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-neutral-400">
                {t('reports.common.loading')}
              </div>
            ) : costQuery.isError ? (
              <div className="py-8 text-center text-sm text-red-500">
                {t('reports.common.error')}
              </div>
            ) : (
              <>
                <CostBreakdownChart data={costs} />
                <DataTable<CostRow>
                  columns={costColumns}
                  data={costRows}
                  keyExtractor={(row) => row.entityId}
                />
              </>
            )}
          </div>
        )}

        {tab === 'operators' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-800">
                {t('reports.operators.heading')}
              </h2>
              <ExportCsvButton
                label={t('reports.common.exportCsv')}
                onClick={handleExportOperators}
                disabled={operatorRows.length === 0}
              />
            </div>
            {operatorStatsQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-neutral-400">
                {t('reports.common.loading')}
              </div>
            ) : operatorStatsQuery.isError ? (
              <div className="py-8 text-center text-sm text-red-500">
                {t('reports.common.error')}
              </div>
            ) : (
              <>
                <OperatorProductionChart data={operatorStatsRaw} />
                <DataTable<OperatorRow>
                  columns={operatorColumns}
                  data={operatorRows}
                  keyExtractor={(row) => row.operatorId}
                />
              </>
            )}
          </div>
        )}
      </div>
      {/* end print:hidden */}
    </div>
  );
}

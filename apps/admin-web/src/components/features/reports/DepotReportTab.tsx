'use client';

import { Download } from 'lucide-react';
import type { DepotReport } from '@strawboss/types';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DepotStockChart } from './DepotStockChart';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';

interface DepotReportTabProps {
  depots: DepotReport[];
  isLoading: boolean;
  isError: boolean;
}

interface DepotRow extends Record<string, unknown> {
  depotId: string;
  depotName: string;
  depotCode: string;
  totalStock: number;
  receivedInPeriod: number;
  arrivingNow: number;
  deliveryCount: number;
}

export function DepotReportTab({
  depots,
  isLoading,
  isError,
}: DepotReportTabProps) {
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

  const columns: Column<DepotRow>[] = [
    {
      key: 'depotName',
      header: t('reports.depots.depot'),
      sortable: true,
      render: (row) => (
        <span className="font-medium text-neutral-800">{row.depotName}</span>
      ),
    },
    { key: 'depotCode', header: t('reports.depots.code'), sortable: true },
    {
      key: 'totalStock',
      header: t('reports.depots.totalStock'),
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-neutral-800">
          {row.totalStock.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'receivedInPeriod',
      header: t('reports.depots.receivedInPeriod'),
      sortable: true,
    },
    {
      key: 'arrivingNow',
      header: t('reports.depots.arrivingNow'),
      sortable: true,
      render: (row) => (
        <span className="text-sm font-medium text-blue-600">
          {row.arrivingNow}
        </span>
      ),
    },
    {
      key: 'deliveryCount',
      header: t('reports.depots.deliveries'),
      sortable: true,
    },
  ];

  const handleExport = () => {
    exportCsv<DepotReport>(
      'depots-report',
      [
        { header: t('reports.depots.depot'), value: (r) => r.depotName },
        { header: t('reports.depots.code'), value: (r) => r.depotCode },
        { header: t('reports.depots.totalStock'), value: (r) => r.totalStock },
        {
          header: t('reports.depots.receivedInPeriod'),
          value: (r) => r.receivedInPeriod,
        },
        {
          header: t('reports.depots.arrivingNow'),
          value: (r) => r.arrivingNow,
        },
        {
          header: t('reports.depots.deliveries'),
          value: (r) => r.deliveryCount,
        },
      ],
      depots,
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">
          {t('reports.depots.chartTitle')}
        </h3>
        <DepotStockChart data={depots} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-800">
          {t('reports.depots.heading')}
        </h2>
        <button
          onClick={handleExport}
          disabled={depots.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t('reports.common.exportCsv')}
        </button>
      </div>

      <DataTable<DepotRow>
        columns={columns}
        data={depots.map((d) => ({ ...d }) as DepotRow)}
        keyExtractor={(row) => row.depotId}
      />

      <p className="text-xs text-neutral-400">{t('reports.depots.matchNote')}</p>
    </div>
  );
}

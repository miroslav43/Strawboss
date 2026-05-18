'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { FarmReport, ReportTimelinePoint } from '@strawboss/types';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FarmProductionChart } from './FarmProductionChart';
import { ReportTimelineChart } from './ReportTimelineChart';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface FarmReportTabProps {
  farms: FarmReport[];
  timeline: ReportTimelinePoint[];
  isLoading: boolean;
  isError: boolean;
}

interface FieldRow extends Record<string, unknown> {
  parcelId: string;
  parcelName: string;
  parcelCode: string;
  produced: number;
  loaded: number;
  delivered: number;
  lossPercentage: number;
}

function lossColor(val: number): string {
  return val > 5 ? 'text-red-600' : val > 2 ? 'text-amber-600' : 'text-green-600';
}

function farmKey(farm: FarmReport): string {
  return farm.farmId ?? '__farmless__';
}

export function FarmReportTab({
  farms,
  timeline,
  isLoading,
  isError,
}: FarmReportTabProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fieldColumns: Column<FieldRow>[] = [
    {
      key: 'parcelName',
      header: t('reports.farms.parcel'),
      sortable: true,
      render: (row) => (
        <span className="font-medium text-neutral-800">{row.parcelName}</span>
      ),
    },
    { key: 'parcelCode', header: t('reports.farms.code'), sortable: true },
    { key: 'produced', header: t('reports.farms.produced'), sortable: true },
    { key: 'loaded', header: t('reports.farms.loaded'), sortable: true },
    { key: 'delivered', header: t('reports.farms.delivered'), sortable: true },
    {
      key: 'lossPercentage',
      header: t('reports.farms.loss'),
      sortable: true,
      render: (row) => (
        <span
          className={cn('text-sm font-medium', lossColor(row.lossPercentage))}
        >
          {row.lossPercentage.toFixed(1)}%
        </span>
      ),
    },
  ];

  const handleExport = () => {
    exportCsv<FarmReport>(
      'farms-report',
      [
        { header: t('reports.farms.farm'), value: (r) => r.farmName },
        { header: t('reports.farms.fields'), value: (r) => r.fieldCount },
        { header: t('reports.farms.produced'), value: (r) => r.produced },
        { header: t('reports.farms.loaded'), value: (r) => r.loaded },
        { header: t('reports.farms.delivered'), value: (r) => r.delivered },
        {
          header: t('reports.farms.loss'),
          value: (r) => r.lossPercentage.toFixed(1),
        },
      ],
      farms,
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">
          {t('reports.farms.chartTitle')}
        </h3>
        <FarmProductionChart data={farms} />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">
          {t('reports.farms.timelineTitle')}
        </h3>
        <ReportTimelineChart data={timeline} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-800">
          {t('reports.farms.heading')}
        </h2>
        <button
          onClick={handleExport}
          disabled={farms.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t('reports.common.exportCsv')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.farm')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.fields')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.produced')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.loaded')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.delivered')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {t('reports.farms.loss')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 bg-white">
            {farms.map((farm) => {
              const key = farmKey(farm);
              const isOpen = expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => toggle(key)}
                    className="cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3 text-neutral-700">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-neutral-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-neutral-400" />
                        )}
                        <span className="font-medium text-neutral-800">
                          {farm.farmName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {farm.fieldCount}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {farm.produced}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{farm.loaded}</td>
                    <td className="px-4 py-3 text-neutral-700">
                      {farm.delivered}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          lossColor(farm.lossPercentage),
                        )}
                      >
                        {farm.lossPercentage.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="bg-neutral-50 px-4 py-3">
                        {farm.fields.length > 0 ? (
                          <DataTable<FieldRow>
                            columns={fieldColumns}
                            data={farm.fields.map(
                              (f) => ({ ...f }) as FieldRow,
                            )}
                            keyExtractor={(row) => row.parcelId}
                          />
                        ) : (
                          <p className="py-2 text-center text-sm text-neutral-400">
                            {t('reports.farms.noFields')}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {farms.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-neutral-400"
                >
                  {t('reports.common.noData')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

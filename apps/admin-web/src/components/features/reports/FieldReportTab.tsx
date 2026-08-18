'use client';

import { useMemo } from 'react';
import {} from 'lucide-react';
import type { FarmReport } from '@strawboss/types';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';
import { ExportButton } from '@/components/shared/ExportButton';

interface FieldRow extends Record<string, unknown> {
  parcelId: string;
  fieldLabel: string;
  farmName: string;
  produced: number;
  loaded: number;
  remaining: number;
  delivered: number;
}

interface FieldReportTabProps {
  farms: FarmReport[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Flat per-field (parcel) production report: every field with how many bales
 * were produced, loaded, what's still left on the field, and delivered. Reuses
 * the farm report endpoint (which already computes the per-field breakdown) and
 * flattens it across all farms into one sortable table.
 */
export function FieldReportTab({ farms, isLoading, isError }: FieldReportTabProps) {
  const { t } = useI18n();
  const localeFmt = useLocaleFormat();
  const fmt = (n: number) => localeFmt.number.format(n);

  const rows: FieldRow[] = useMemo(() => {
    const out: FieldRow[] = [];
    for (const farm of farms) {
      for (const f of farm.fields) {
        out.push({
          parcelId: f.parcelId,
          fieldLabel: f.parcelName || f.parcelCode || f.parcelId.slice(0, 8),
          farmName: farm.farmName,
          produced: f.produced,
          loaded: f.loaded,
          remaining: Math.max(0, f.produced - f.loaded),
          delivered: f.delivered,
        });
      }
    }
    return out.sort((a, b) => b.produced - a.produced);
  }, [farms]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          produced: acc.produced + r.produced,
          loaded: acc.loaded + r.loaded,
          remaining: acc.remaining + r.remaining,
          delivered: acc.delivered + r.delivered,
        }),
        { produced: 0, loaded: 0, remaining: 0, delivered: 0 },
      ),
    [rows],
  );

  const columns: Column<FieldRow>[] = [
    {
      key: 'fieldLabel',
      header: t('reports.fields.field'),
      sortable: true,
      render: (r) => <span className="font-medium text-neutral-800">{r.fieldLabel}</span>,
    },
    {
      key: 'farmName',
      header: t('reports.fields.farm'),
      render: (r) => <span className="text-neutral-500">{r.farmName}</span>,
    },
    {
      key: 'produced',
      header: t('reports.fields.produced'),
      sortable: true,
      render: (r) => fmt(r.produced),
    },
    {
      key: 'loaded',
      header: t('reports.fields.loaded'),
      sortable: true,
      render: (r) => fmt(r.loaded),
    },
    {
      key: 'remaining',
      header: t('reports.fields.remaining'),
      sortable: true,
      render: (r) => <span className="font-semibold text-neutral-800">{fmt(r.remaining)}</span>,
    },
    {
      key: 'delivered',
      header: t('reports.fields.delivered'),
      sortable: true,
      render: (r) => fmt(r.delivered),
    },
  ];

  const handleExport = () => {
    exportCsv<FieldRow>(
      'fields-report',
      [
        { header: t('reports.fields.field'), value: (r) => r.fieldLabel },
        { header: t('reports.fields.farm'), value: (r) => r.farmName },
        { header: t('reports.fields.produced'), value: (r) => r.produced },
        { header: t('reports.fields.loaded'), value: (r) => r.loaded },
        { header: t('reports.fields.remaining'), value: (r) => r.remaining },
        { header: t('reports.fields.delivered'), value: (r) => r.delivered },
      ],
      rows,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-800">{t('reports.fields.heading')}</h2>
        <ExportButton
          label={t('reports.common.exportCsv')}
          onClick={handleExport}
          disabled={rows.length === 0}
        />
      </div>

      {/* Totals across all fields */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label={t('reports.fields.produced')} value={fmt(totals.produced)} />
        <KpiTile label={t('reports.fields.loaded')} value={fmt(totals.loaded)} />
        <KpiTile label={t('reports.fields.remaining')} value={fmt(totals.remaining)} />
        <KpiTile label={t('reports.fields.delivered')} value={fmt(totals.delivered)} />
      </div>

      {isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('reports.common.error')}</div>
      ) : isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.noData')}
        </div>
      ) : (
        <DataTable<FieldRow> columns={columns} data={rows} keyExtractor={(r) => r.parcelId} />
      )}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-800">{value}</p>
    </div>
  );
}

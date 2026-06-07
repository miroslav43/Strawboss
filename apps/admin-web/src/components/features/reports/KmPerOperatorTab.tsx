'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useOperatorDistanceReport } from '@strawboss/api';
import type { OperatorDistanceRow } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';

interface KmPerOperatorTabProps {
  dateFrom: string;
  dateTo: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

interface CsvRow extends Record<string, unknown> {
  operator: string;
  date: string;
  km: number;
  pointCount: number;
}

/**
 * Km per driver (operator), derived from the GPS trace the same way as the
 * per-truck report but attributed to whoever was driving. Pivots operator × day
 * with a running total, mirroring the Connected-hours tab.
 */
export function KmPerOperatorTab({ dateFrom, dateTo }: KmPerOperatorTabProps) {
  const { t } = useI18n();
  const from = dateFrom || defaultFrom();
  const to = dateTo || todayISO();

  const reportQuery = useOperatorDistanceReport(apiClient, { from, to });
  const rows = useMemo<OperatorDistanceRow[]>(() => reportQuery.data ?? [], [reportQuery.data]);
  const isLoading = reportQuery.isLoading;
  const isError = reportQuery.isError;

  // Distinct day columns, ordered ascending.
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.date);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Pivot per operator: a date→km map plus a running total.
  const byOperator = useMemo(() => {
    const map = new Map<string, { name: string; perDay: Map<string, number>; total: number }>();
    for (const r of rows) {
      const key = r.operatorId ?? '__none__';
      let entry = map.get(key);
      if (!entry) {
        entry = { name: r.operatorName ?? 'N/A', perDay: new Map(), total: 0 };
        map.set(key, entry);
      }
      entry.perDay.set(r.date, (entry.perDay.get(r.date) ?? 0) + r.distanceKm);
      entry.total += r.distanceKm;
    }
    return [...map.entries()]
      .map(([operatorId, v]) => ({ operatorId, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const totalKm = useMemo(() => rows.reduce((s, r) => s + r.distanceKm, 0), [rows]);
  const activeDrivers = byOperator.length;

  const csvRows: CsvRow[] = useMemo(
    () =>
      rows.map((r) => ({
        operator: r.operatorName ?? 'N/A',
        date: r.date,
        km: r.distanceKm,
        pointCount: r.pointCount,
      })),
    [rows],
  );

  const handleExport = () => {
    exportCsv<CsvRow>(
      'km-per-operator',
      [
        { header: 'operator', value: (r) => r.operator },
        { header: 'date', value: (r) => r.date },
        { header: 'km', value: (r) => r.km },
        { header: 'pointCount', value: (r) => r.pointCount },
      ],
      csvRows,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-800">
          {t('reports.kmPerOperator.title')}
        </h2>
        <button
          onClick={handleExport}
          disabled={csvRows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t('reports.common.exportCsv')}
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label={t('reports.kmPerOperator.totalKm')} value={totalKm.toFixed(2)} />
        <KpiTile label={t('reports.kmPerOperator.activeDrivers')} value={String(activeDrivers)} />
      </div>

      {isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('reports.common.error')}</div>
      ) : isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.loading')}
        </div>
      ) : byOperator.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.kmPerOperator.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.kmPerOperator.colDriver')}
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500"
                  >
                    {d.slice(5)}
                  </th>
                ))}
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.connectedHours.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {byOperator.map((op) => (
                <tr key={op.operatorId} className="hover:bg-neutral-50/60">
                  <td className="px-4 py-2 font-medium text-neutral-800">{op.name}</td>
                  {dates.map((d) => (
                    <td
                      key={d}
                      className="px-3 py-2 text-right text-sm tabular-nums text-neutral-700"
                    >
                      {(op.perDay.get(d) ?? 0).toFixed(2)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-800">
                    {op.total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-right text-[10px] text-neutral-400">UTC</p>
        </div>
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

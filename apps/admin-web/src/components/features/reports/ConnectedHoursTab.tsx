'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useUserConnectedHoursReport } from '@strawboss/api';
import type { ConnectedHoursGroupBy, ConnectedHoursRow } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';
import { roleLabelKey } from '@/lib/role-labels';
import { cn } from '@/lib/utils';

interface ConnectedHoursTabProps {
  dateFrom: string;
  dateTo: string;
  groupBy: ConnectedHoursGroupBy;
  onChangeGroupBy: (g: ConnectedHoursGroupBy) => void;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}

interface CsvRow extends Record<string, unknown> {
  user: string;
  role: string;
  period: string;
  hours: number;
}

export function ConnectedHoursTab({
  dateFrom,
  dateTo,
  groupBy,
  onChangeGroupBy,
}: ConnectedHoursTabProps) {
  const { t } = useI18n();
  const from = dateFrom || defaultFrom();
  const to = dateTo || todayISO();

  const reportQuery = useUserConnectedHoursReport(apiClient, { from, to, groupBy });
  const rows = reportQuery.data?.rows ?? [];
  const isLoading = reportQuery.isLoading;
  const isError = reportQuery.isError;

  // KPI summary: total hours across all users + period, average per active user,
  // count of distinct users who logged any time in the range.
  const { totalHours, activeUsers, avgHours } = useMemo(() => {
    let total = 0;
    const users = new Set<string>();
    for (const r of rows) {
      total += r.hours;
      users.add(r.userId);
    }
    const active = users.size;
    return {
      totalHours: total,
      activeUsers: active,
      avgHours: active > 0 ? total / active : 0,
    };
  }, [rows]);

  // Group rows by user for the table. Each user becomes a row; columns are the
  // distinct periods present in the data, ordered by period start.
  const periods = useMemo(() => {
    const map = new Map<string, string>(); // period → periodStart (for sorting)
    for (const r of rows) {
      if (!map.has(r.period)) map.set(r.period, r.periodStart);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([period]) => period);
  }, [rows]);

  const byUser = useMemo(() => {
    const map = new Map<
      string,
      { name: string; role: string; perPeriod: Map<string, number>; total: number }
    >();
    for (const r of rows) {
      let entry = map.get(r.userId);
      if (!entry) {
        entry = { name: r.userName, role: r.role, perPeriod: new Map(), total: 0 };
        map.set(r.userId, entry);
      }
      entry.perPeriod.set(r.period, (entry.perPeriod.get(r.period) ?? 0) + r.hours);
      entry.total += r.hours;
    }
    return [...map.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const csvRows: CsvRow[] = useMemo(
    () =>
      rows.map((r: ConnectedHoursRow) => ({
        user: r.userName,
        role: t(roleLabelKey(r.role)),
        period: r.period,
        hours: r.hours,
      })),
    [rows, t],
  );

  const handleExport = () => {
    exportCsv<CsvRow>(
      'connected-hours',
      [
        { header: 'user', value: (r) => r.user },
        { header: 'role', value: (r) => r.role },
        { header: 'period', value: (r) => r.period },
        { header: 'hours', value: (r) => r.hours },
      ],
      csvRows,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-800">
          {t('reports.connectedHours.title')}
        </h2>
        <div className="flex items-center gap-3">
          {/* Group-by selector */}
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
            {(['day', 'week', 'month'] as ConnectedHoursGroupBy[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onChangeGroupBy(g)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  groupBy === g
                    ? 'bg-neutral-100 text-neutral-800'
                    : 'text-neutral-500 hover:text-neutral-700',
                )}
              >
                {t(`reports.connectedHours.${g}`)}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            disabled={csvRows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t('reports.common.exportCsv')}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label={t('reports.connectedHours.totalHours')} value={totalHours.toFixed(1)} />
        <KpiTile label={t('reports.connectedHours.activeUsers')} value={String(activeUsers)} />
        <KpiTile label={t('reports.connectedHours.avgHours')} value={avgHours.toFixed(1)} />
      </div>

      {isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('reports.common.error')}</div>
      ) : isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.loading')}
        </div>
      ) : byUser.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.noData')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.connectedHours.user')}
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.connectedHours.role')}
                </th>
                {periods.map((p) => (
                  <th
                    key={p}
                    className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500"
                  >
                    {p}
                  </th>
                ))}
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.connectedHours.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {byUser.map((u) => (
                <tr key={u.userId} className="hover:bg-neutral-50/60">
                  <td className="px-4 py-2 font-medium text-neutral-800">{u.name}</td>
                  <td className="px-4 py-2 text-neutral-600">{t(roleLabelKey(u.role))}</td>
                  {periods.map((p) => (
                    <td
                      key={p}
                      className="px-3 py-2 text-right text-sm tabular-nums text-neutral-700"
                    >
                      {(u.perPeriod.get(p) ?? 0).toFixed(1)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-800">
                    {u.total.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-800 tabular-nums">{value}</p>
    </div>
  );
}

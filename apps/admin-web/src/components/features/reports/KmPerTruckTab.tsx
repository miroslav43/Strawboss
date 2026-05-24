'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@strawboss/api';
import type { KmByDayResponse, Machine, MachineType, PaginatedResponse } from '@strawboss/types';
import { useMachines } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { useI18n } from '@/lib/i18n';
import { KmPerTruckChart, type KmChartRow } from './KmPerTruckChart';

interface KmPerTruckTabProps {
  dateFrom: string;
  dateTo: string;
}

const PALETTE = [
  '#4f7942', // primary green
  '#1565C0',
  '#B7791F',
  '#8D6E63',
  '#dc2626',
  '#7c3aed',
];

const MAX_SELECTED = 6;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

interface CsvRow extends Record<string, unknown> {
  machine: string;
  date: string;
  km: number;
  pointCount: number;
}

export function KmPerTruckTab({ dateFrom, dateTo }: KmPerTruckTabProps) {
  const { t } = useI18n();
  const from = dateFrom || defaultFrom();
  const to = dateTo || todayISO();

  const machinesQuery = useMachines(apiClient);
  const machinesRaw = machinesQuery.data;
  const allMachines = useMemo<Machine[]>(() => {
    if (!machinesRaw) return [];
    if (Array.isArray(machinesRaw)) return machinesRaw as Machine[];
    return (machinesRaw as PaginatedResponse<Machine>).data ?? [];
  }, [machinesRaw]);

  const trucks = useMemo(
    () => allMachines.filter((m) => (m.machineType as MachineType) === 'truck'),
    [allMachines],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Default to first truck when data lands.
  useEffect(() => {
    if (trucks.length > 0 && selectedIds.length === 0) {
      setSelectedIds([trucks[0].id]);
    }
  }, [trucks, selectedIds.length]);

  const cappedSelected = selectedIds.slice(0, MAX_SELECTED);

  const queries = useQueries({
    queries: cappedSelected.map((machineId) => ({
      queryKey: queryKeys.location.kmByDay(machineId, from, to),
      queryFn: () =>
        apiClient.get<KmByDayResponse>(
          `/api/v1/location/machines/${machineId}/km-by-day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      enabled: !!machineId,
    })),
  });

  const responses = queries.map((q) => q.data).filter((r): r is KmByDayResponse => !!r);
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  // Build chart rows: { date, [machineCode]: km, ... }
  const chartRows: KmChartRow[] = useMemo(() => {
    if (responses.length === 0) return [];
    const byDate = new Map<string, KmChartRow>();
    for (const resp of responses) {
      const code = resp.machineCode ?? resp.machineId.slice(0, 6);
      for (const d of resp.days) {
        const row = byDate.get(d.date) ?? { date: d.date };
        row[code] = d.km;
        byDate.set(d.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [responses]);

  const machinesForChart = useMemo(
    () =>
      responses.map((r, i) => ({
        code: r.machineCode ?? r.machineId.slice(0, 6),
        color: PALETTE[i % PALETTE.length],
      })),
    [responses],
  );

  const csvRows: CsvRow[] = useMemo(() => {
    const out: CsvRow[] = [];
    for (const r of responses) {
      const code = r.machineCode ?? r.machineId.slice(0, 6);
      for (const d of r.days) {
        out.push({ machine: code, date: d.date, km: d.km, pointCount: d.pointCount });
      }
    }
    return out;
  }, [responses]);

  const handleExport = () => {
    exportCsv<CsvRow>(
      'km-per-truck',
      [
        { header: 'machine', value: (r) => r.machine },
        { header: 'date', value: (r) => r.date },
        { header: 'km', value: (r) => r.km },
        { header: 'pointCount', value: (r) => r.pointCount },
      ],
      csvRows,
    );
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-800">{t('reports.kmPerTruck.title')}</h2>
        <button
          onClick={handleExport}
          disabled={csvRows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {t('reports.kmPerTruck.export')}
        </button>
      </div>

      {/* Truck selector chips */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t('reports.kmPerTruck.selectMachines')}
        </div>
        {trucks.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('reports.kmPerTruck.noMachines')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trucks.map((m) => {
              const active = selectedIds.includes(m.id);
              const idx = cappedSelected.indexOf(m.id);
              const swatch = idx >= 0 ? PALETTE[idx % PALETTE.length] : '#9ca3af';
              const code = m.internalCode ?? m.registrationPlate ?? m.id.slice(0, 6);
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                    active
                      ? 'border-neutral-300 bg-neutral-50 text-neutral-800'
                      : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: active ? swatch : '#d4d4d4' }}
                    aria-hidden
                  />
                  {code}
                </button>
              );
            })}
          </div>
        )}
        {selectedIds.length > MAX_SELECTED && (
          <p className="mt-2 text-xs text-amber-600">
            {t('reports.kmPerTruck.selectMachines')} ≤ {MAX_SELECTED}
          </p>
        )}
      </div>

      {/* Chart + table */}
      {isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('reports.common.error')}</div>
      ) : isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.loading')}
        </div>
      ) : responses.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.kmPerTruck.empty')}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <KmPerTruckChart data={chartRows} machines={machinesForChart} />
            <p className="mt-2 text-right text-[10px] text-neutral-400">UTC</p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    {t('reports.kmPerTruck.selectMachines')}
                  </th>
                  {chartRows.map((r) => (
                    <th
                      key={r.date}
                      className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500"
                    >
                      {r.date.slice(5)}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {responses.map((resp) => {
                  const code = resp.machineCode ?? resp.machineId.slice(0, 6);
                  const totalKm = resp.days.reduce((s, d) => s + d.km, 0);
                  return (
                    <tr key={resp.machineId} className="hover:bg-neutral-50/60">
                      <td className="px-4 py-2 font-medium text-neutral-800">{code}</td>
                      {resp.days.map((d) => (
                        <td
                          key={d.date}
                          className="px-3 py-2 text-right text-sm tabular-nums text-neutral-700"
                        >
                          {d.km.toFixed(2)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-800">
                        {t('reports.kmPerTruck.totalKm', { km: totalKm.toFixed(2) })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

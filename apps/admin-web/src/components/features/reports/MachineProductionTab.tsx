'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { useMachineOperatorProduction } from '@strawboss/api';
import type { MachineProductionReport } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface MachineProductionTabProps {
  dateFrom: string;
  dateTo: string;
}

interface CsvRow extends Record<string, unknown> {
  machine: string;
  operator: string;
  bales: number;
  sessions: number;
}

/**
 * Bales produced per baler machine, expandable to the operators who produced on
 * each. The shared DataTable has no nested-row support, so this is a purpose-built
 * grouped table: machine rows toggle their operator children open/closed.
 */
export function MachineProductionTab({ dateFrom, dateTo }: MachineProductionTabProps) {
  const { t } = useI18n();

  const filters = useMemo(() => {
    const f: { dateFrom?: string; dateTo?: string } = {};
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    return f;
  }, [dateFrom, dateTo]);

  const query = useMachineOperatorProduction(apiClient, filters, { enabled: true });
  const machines = useMemo<MachineProductionReport[]>(() => query.data ?? [], [query.data]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const keyOf = (m: MachineProductionReport) => m.machineId ?? '__none__';
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalBales = useMemo(() => machines.reduce((s, m) => s + m.totalBales, 0), [machines]);

  const csvRows: CsvRow[] = useMemo(() => {
    const out: CsvRow[] = [];
    for (const m of machines) {
      for (const op of m.operators) {
        out.push({
          machine: m.machineCode,
          operator: op.operatorName,
          bales: op.totalBales,
          sessions: op.sessionCount,
        });
      }
    }
    return out;
  }, [machines]);

  const handleExport = () => {
    exportCsv<CsvRow>(
      'machine-production',
      [
        { header: 'machine', value: (r) => r.machine },
        { header: 'operator', value: (r) => r.operator },
        { header: 'bales', value: (r) => r.bales },
        { header: 'sessions', value: (r) => r.sessions },
      ],
      csvRows,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-800">
          {t('reports.machineProduction.title')}
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

      <div className="grid grid-cols-2 gap-3">
        <KpiTile label={t('reports.machineProduction.totalBales')} value={String(totalBales)} />
        <KpiTile label={t('reports.machineProduction.machines')} value={String(machines.length)} />
      </div>

      {query.isError ? (
        <div className="py-8 text-center text-sm text-red-500">{t('reports.common.error')}</div>
      ) : query.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.common.loading')}
        </div>
      ) : machines.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('reports.machineProduction.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.machineProduction.colMachine')}
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.machineProduction.colOperators')}
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.machineProduction.colSessions')}
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('reports.machineProduction.colBales')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {machines.map((m) => {
                const key = keyOf(m);
                const isOpen = expanded.has(key);
                return (
                  <FragmentRow
                    key={key}
                    machine={m}
                    isOpen={isOpen}
                    onToggle={() => toggle(key)}
                    balesLabel={t('reports.common.bales')}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  machine,
  isOpen,
  onToggle,
  balesLabel,
}: {
  machine: MachineProductionReport;
  isOpen: boolean;
  onToggle: () => void;
  balesLabel: string;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-neutral-50/60" onClick={onToggle}>
        <td className="px-4 py-2 font-medium text-neutral-800">
          <span className="inline-flex items-center gap-1.5">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-neutral-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-neutral-400" />
            )}
            {machine.machineCode}
          </span>
        </td>
        <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
          {machine.operatorCount}
        </td>
        <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
          {machine.sessionCount}
        </td>
        <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-800">
          {machine.totalBales}
        </td>
      </tr>
      {isOpen &&
        machine.operators.map((op, idx) => (
          <tr key={op.operatorId ?? `${idx}`} className="bg-neutral-50/40">
            <td className="py-1.5 pl-11 pr-4 text-neutral-700">{op.operatorName}</td>
            <td className="px-4 py-1.5 text-right text-neutral-400">—</td>
            <td className="px-4 py-1.5 text-right tabular-nums text-neutral-500">
              {op.sessionCount}
            </td>
            <td className={cn('px-4 py-1.5 text-right tabular-nums text-neutral-700')}>
              {op.totalBales} {balesLabel}
            </td>
          </tr>
        ))}
    </>
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

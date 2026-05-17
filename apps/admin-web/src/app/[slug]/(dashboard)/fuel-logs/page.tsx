'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMachines } from '@strawboss/api';
import type { Machine } from '@strawboss/types';
import { ChevronDown, ChevronRight, Fuel, User, Calendar } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReceiptThumb } from '@/components/shared/ReceiptThumb';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';

/**
 * Raw backend row shape (snake_case because the controller returns the SQL
 * result as-is). We only pick the fields the table renders.
 */
interface FuelLogRow {
  id: string;
  machine_id: string | null;
  operator_id: string | null;
  parcel_id: string | null;
  logged_at: string;
  fuel_type: string | null;
  quantity_liters: string | number;
  odometer_km: string | number | null;
  receipt_photo_url: string | null;
  notes: string | null;
}

interface MachineGroup {
  machineId: string;
  machine: Machine | null;
  totalLiters: number;
  entries: FuelLogRow[];
}

/** Default window = last 30 days, which matches the mobile stats endpoint. */
function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export default function FuelLogsPage() {
  const { t } = useI18n();
  const initial = useMemo(defaultDateRange, []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const machinesQuery = useMachines(apiClient);
  const machines = useMemo<Machine[]>(
    () => normalizeList<Machine>(machinesQuery.data),
    [machinesQuery.data],
  );
  const machineById = useMemo(() => {
    const map = new Map<string, Machine>();
    for (const m of machines) map.set(m.id, m);
    return map;
  }, [machines]);

  const logsQuery = useQuery({
    queryKey: ['fuel-logs', 'admin-list', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', `${dateFrom}T00:00:00Z`);
      if (dateTo) params.set('dateTo', `${dateTo}T23:59:59Z`);
      const raw = await apiClient.get<unknown>(
        `/api/v1/fuel-logs?${params.toString()}`,
      );
      return normalizeList<FuelLogRow>(raw);
    },
  });

  const grouped = useMemo<MachineGroup[]>(() => {
    const rows = logsQuery.data ?? [];
    const byMachine = new Map<string, MachineGroup>();
    for (const row of rows) {
      const key = row.machine_id ?? 'unknown';
      let group = byMachine.get(key);
      if (!group) {
        group = {
          machineId: key,
          machine: row.machine_id ? machineById.get(row.machine_id) ?? null : null,
          totalLiters: 0,
          entries: [],
        };
        byMachine.set(key, group);
      }
      group.totalLiters += toNumber(row.quantity_liters);
      group.entries.push(row);
    }
    const groups = Array.from(byMachine.values());
    groups.sort((a, b) => b.totalLiters - a.totalLiters);
    for (const g of groups) {
      g.entries.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
    }
    return groups;
  }, [logsQuery.data, machineById]);

  const totalLiters = useMemo(
    () => grouped.reduce((sum, g) => sum + g.totalLiters, 0),
    [grouped],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <PageHeader title={t('nav.fuelLogs')} />

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">
            {t('fuelLogs.dateFrom')}
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">
            {t('fuelLogs.dateTo')}
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-md bg-primary/10 px-4 py-2 text-sm text-primary">
          <Fuel className="h-4 w-4" />
          <span className="font-semibold">
            {totalLiters.toFixed(1)} {t('fuelLogs.liters')}
          </span>
          <span className="text-neutral-500">
            · {logsQuery.data?.length ?? 0} {t('fuelLogs.entries')}
          </span>
        </div>
      </div>

      {logsQuery.isLoading ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
          {t('common.loading')}
        </div>
      ) : logsQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-red-700">
          {t('common.error')}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
          {t('fuelLogs.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            const isOpen = expanded.has(group.machineId);
            const machineLabel = group.machine
              ? `${group.machine.registrationPlate} · ${group.machine.make} ${group.machine.model}`
              : t('fuelLogs.unknownMachine');
            return (
              <div
                key={group.machineId}
                className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggle(group.machineId)}
                  className="flex w-full items-center justify-between px-4 py-3 hover:bg-neutral-50"
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-neutral-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-neutral-500" />
                    )}
                    <Fuel className="h-5 w-5 text-primary" />
                    <span className="font-medium text-neutral-900">
                      {machineLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-neutral-500">
                      {group.entries.length} {t('fuelLogs.entries')}
                    </span>
                    <span className="font-semibold text-primary">
                      {group.totalLiters.toFixed(1)} L
                    </span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                    {group.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-4 px-4 py-3"
                      >
                        <ReceiptThumb
                          url={entry.receipt_photo_url}
                          caption={`${machineLabel} · ${formatDateTime(entry.logged_at)}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                            <span className="flex items-center gap-1 text-neutral-600">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDateTime(entry.logged_at)}
                            </span>
                            {entry.operator_id ? (
                              <span className="flex items-center gap-1 text-neutral-500">
                                <User className="h-3.5 w-3.5" />
                                {entry.operator_id.slice(0, 8)}
                              </span>
                            ) : null}
                            {entry.odometer_km != null ? (
                              <span className="text-neutral-500">
                                {toNumber(entry.odometer_km).toFixed(0)} km
                              </span>
                            ) : null}
                          </div>
                          {entry.notes ? (
                            <p className="mt-1 text-sm text-neutral-600">
                              {entry.notes}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-neutral-900">
                            {toNumber(entry.quantity_liters).toFixed(1)} L
                          </div>
                          {entry.fuel_type ? (
                            <div className="text-xs uppercase text-neutral-500">
                              {entry.fuel_type}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

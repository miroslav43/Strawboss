'use client';

import { useMemo, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { Wheat, Plus, Map as MapIcon, Trash2, Loader2, Check, Tractor, MapPin } from 'lucide-react';
import {
  useBaleProductions,
  useParcels,
  useCreateBaleProduction,
  useDeleteBaleProduction,
} from '@strawboss/api';
import type { BaleProduction, Parcel } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { todayInRomania } from '@/lib/date';
import { FarmParcelCascade } from '@/components/features/tasks/machine-plan/FarmParcelCascade';

// The map picker mounts a Leaflet map — load it client-side only.
const ParcelMapModal = dynamicImport(
  () =>
    import('@/components/features/tasks/daily-plan/ParcelMapModal').then((m) => ({
      default: m.ParcelMapModal,
    })),
  { ssr: false },
);

const EMPTY_SET = new Set<string>();
const EMPTY_COUNTS = new Map<string, number>();

/** 'YYYY-MM-DD[...]' → 'DD.MM.YYYY' without timezone drift. */
function formatDate(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-');
  return day && m && y ? `${day}.${m}.${y}` : d;
}

interface FarmHistory {
  farmName: string;
  total: number;
  parcels: { code: string; count: number }[];
}

/**
 * Baler-page card: record the bales this baler produced against a chosen field
 * (farm → parcel), list every production entry for the baler, and show a
 * farm-grouped history with totals. Real rows go to `bale_productions`, so the
 * parcel's produced tally updates automatically.
 */
export function BaleProductionCard({ machineId }: { machineId: string }) {
  const { t } = useI18n();

  const productionsQuery = useBaleProductions(apiClient, { balerId: machineId });
  const parcelsQuery = useParcels(apiClient);

  const createMutation = useCreateBaleProduction(apiClient);
  const deleteMutation = useDeleteBaleProduction(apiClient);

  const entries = useMemo<BaleProduction[]>(
    () => normalizeList<BaleProduction>(productionsQuery.data),
    [productionsQuery.data],
  );
  const parcels = useMemo<Parcel[]>(
    () => normalizeList<Parcel>(parcelsQuery.data),
    [parcelsQuery.data],
  );
  const parcelMap = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);

  // ── Add-form state ────────────────────────────────────────────────────────
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [count, setCount] = useState('');
  const [date, setDate] = useState(todayInRomania());
  const [avgWeight, setAvgWeight] = useState('');
  const [showCascade, setShowCascade] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const selectedParcel = parcelId ? parcelMap.get(parcelId) : undefined;

  function parcelLabel(p: Parcel | undefined): string {
    if (!p) return t('machineDetail.baleProduction.pickField');
    const farm = p.farmName ?? t('machineDetail.baleProduction.noParcel');
    return `${farm} · ${p.code}`;
  }

  function handleAdd() {
    setError('');
    if (!parcelId) {
      setError(t('machineDetail.baleProduction.pickFieldFirst'));
      return;
    }
    const baleCount = parseInt(count, 10);
    if (Number.isNaN(baleCount) || baleCount <= 0) {
      setError(t('machineDetail.baleProduction.invalidCount'));
      return;
    }
    const avg = avgWeight.trim() === '' ? null : Number(avgWeight);
    createMutation.mutate(
      {
        // operatorId is intentionally omitted — an admin recording production
        // from the web has no operator; the backend stores NULL.
        parcelId,
        balerId: machineId,
        productionDate: date,
        baleCount,
        avgBaleWeightKg: avg != null && !Number.isNaN(avg) && avg > 0 ? avg : null,
      },
      {
        onSuccess: () => {
          setParcelId(null);
          setCount('');
          setAvgWeight('');
          setDate(todayInRomania());
        },
        onError: () => setError(t('machineDetail.baleProduction.addError')),
      },
    );
  }

  function handleDelete(id: string) {
    setError('');
    deleteMutation.mutate(id, {
      onSuccess: () => setPendingDeleteId(null),
      onError: () => {
        setPendingDeleteId(null);
        setError(t('machineDetail.baleProduction.deleteError'));
      },
    });
  }

  // ── Farm-grouped history ─────────────────────────────────────────────────
  const history = useMemo<FarmHistory[]>(() => {
    const byFarm = new Map<string, FarmHistory & { parcelCounts: Map<string, number> }>();
    for (const e of entries) {
      const p = parcelMap.get(e.parcelId);
      const farmName = p?.farmName ?? t('machineDetail.baleProduction.noParcel');
      const code = p?.code ?? '—';
      let g = byFarm.get(farmName);
      if (!g) {
        g = { farmName, total: 0, parcels: [], parcelCounts: new Map() };
        byFarm.set(farmName, g);
      }
      g.total += e.baleCount;
      g.parcelCounts.set(code, (g.parcelCounts.get(code) ?? 0) + e.baleCount);
    }
    const arr = [...byFarm.values()].map((g) => ({
      farmName: g.farmName,
      total: g.total,
      parcels: [...g.parcelCounts.entries()]
        .map(([code, c]) => ({ code, count: c }))
        .sort((a, b) => b.count - a.count),
    }));
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [entries, parcelMap, t]);

  const grandTotal = useMemo(() => entries.reduce((s, e) => s + e.baleCount, 0), [entries]);

  const onPick = (id: string) => {
    setParcelId(id);
    setError('');
  };

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      {showMap && (
        <ParcelMapModal parcels={parcels} onSelect={onPick} onClose={() => setShowMap(false)} />
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <Wheat className="h-4 w-4 text-amber-600" />
          {t('machineDetail.baleProduction.title')}
        </h3>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          {t('machineDetail.baleProduction.total')}: {grandTotal}
        </span>
      </div>

      {/* Add form */}
      <div className="space-y-3 rounded-xl border border-neutral-100 bg-neutral-50/60 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('machineDetail.baleProduction.addHeading')}
        </h4>

        {/* Field picker (cascade + map) */}
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">
            {t('machineDetail.baleProduction.field')}
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setShowCascade((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left text-sm hover:border-neutral-400"
              >
                <Tractor className="h-4 w-4 shrink-0 text-neutral-400" />
                <span
                  className={
                    selectedParcel ? 'truncate text-neutral-800' : 'truncate text-neutral-400'
                  }
                >
                  {parcelLabel(selectedParcel)}
                </span>
              </button>
              {showCascade && (
                <FarmParcelCascade
                  parcels={parcels}
                  excludeParcelIds={EMPTY_SET}
                  assignedCountByParcel={EMPTY_COUNTS}
                  color="amber"
                  onSelect={onPick}
                  onClose={() => setShowCascade(false)}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowMap(true)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
              title={t('machineDetail.baleProduction.onMap')}
            >
              <MapIcon className="h-4 w-4" />
              {t('machineDetail.baleProduction.onMap')}
            </button>
          </div>
        </div>

        {/* Count + date + avg weight */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              {t('machineDetail.baleProduction.count')}
            </label>
            <input
              type="number"
              min="1"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              {t('machineDetail.baleProduction.date')}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              {t('machineDetail.baleProduction.avgWeight')}
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={avgWeight}
              onChange={(e) => setAvgWeight(e.target.value)}
              placeholder={t('machineDetail.baleProduction.optional')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t('machineDetail.baleProduction.save')}
        </button>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}
      </div>

      {/* Farm-grouped history */}
      <div className="mt-6">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('machineDetail.baleProduction.historyHeading')}
        </h4>
        {productionsQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
        ) : history.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('machineDetail.baleProduction.noEntries')}</p>
        ) : (
          <ul className="space-y-2">
            {history.map((farm) => (
              <li key={farm.farmName} className="rounded-xl border border-neutral-100 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                    <Tractor className="h-3.5 w-3.5 text-neutral-400" />
                    {farm.farmName}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {farm.total} {t('machineDetail.baleProduction.bales')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {farm.parcels.map((p) => (
                    <span
                      key={p.code}
                      className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                    >
                      <MapPin className="h-3 w-3 text-neutral-400" />
                      <span className="font-mono">{p.code}</span>
                      <span className="font-semibold text-neutral-800">{p.count}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* All entries */}
      <div className="mt-6">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('machineDetail.baleProduction.entriesHeading')}
        </h4>
        {productionsQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('machineDetail.baleProduction.noEntries')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs font-medium uppercase tracking-wider text-neutral-400">
                <th className="pb-2 pr-4">{t('machineDetail.baleProduction.colDate')}</th>
                <th className="pb-2 pr-4">{t('machineDetail.baleProduction.colField')}</th>
                <th className="pb-2 pr-4">{t('machineDetail.baleProduction.colCount')}</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {entries.map((e) => {
                const p = parcelMap.get(e.parcelId);
                return (
                  <tr key={e.id}>
                    <td className="py-2 pr-4 text-neutral-600">{formatDate(e.productionDate)}</td>
                    <td className="py-2 pr-4 text-neutral-700">
                      <span className="text-neutral-500">
                        {p?.farmName ?? t('machineDetail.baleProduction.noParcel')}
                      </span>{' '}
                      <span className="font-mono text-xs text-neutral-700">{p?.code ?? '—'}</span>
                    </td>
                    <td className="py-2 pr-4 font-semibold text-neutral-800">{e.baleCount}</td>
                    <td className="py-2 text-right">
                      {pendingDeleteId === e.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {t('machineDetail.baleProduction.confirmDelete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                          >
                            {t('common.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(e.id)}
                          className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          title={t('machineDetail.baleProduction.deleteEntry')}
                          aria-label={t('machineDetail.baleProduction.deleteEntry')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

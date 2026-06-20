'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { X, Trash2, Eye, EyeOff } from 'lucide-react';
import { useMachines } from '@strawboss/api';
import { MachineType } from '@strawboss/types';
import type { Machine, RouteHistoryResponse } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { TrackRoute } from '@/components/tracks/TracksMap';

const TracksMap = dynamicImport(
  () => import('@/components/tracks/TracksMap').then((m) => ({ default: m.TracksMap })),
  { ssr: false, loading: () => <div className="h-full w-full bg-neutral-100" /> },
);

const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// Distinct colours auto-assigned to successive tracks (user can override).
const PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

const TYPE_LABEL_KEY: Record<MachineType, string> = {
  [MachineType.truck]: 'machines.typeSingular.truck',
  [MachineType.loader]: 'machines.typeSingular.loader',
  [MachineType.baler]: 'machines.typeSingular.baler',
};

type Preset = 'lastHour' | 'lastDay' | 'lastWeek' | 'lastMonth' | 'custom';
const PRESETS: Preset[] = ['lastHour', 'lastDay', 'lastWeek', 'lastMonth', 'custom'];
const PRESET_MS: Record<Exclude<Preset, 'custom'>, number> = {
  lastHour: 3_600_000,
  lastDay: 86_400_000,
  lastWeek: 7 * 86_400_000,
  lastMonth: 30 * 86_400_000,
};

interface Track extends TrackRoute {
  from: string;
  to: string;
  visible: boolean;
}

function toMachineList(raw: unknown): Machine[] {
  // /api/v1/machines returns a plain array; tolerate a paginated wrapper too.
  if (Array.isArray(raw)) return raw as Machine[];
  const paginated = raw as { data?: Machine[] } | null | undefined;
  return paginated?.data ?? [];
}

function machineLabel(m: Machine): string {
  return `${m.internalCode} — ${m.make} ${m.model}`.trim();
}

export default function TracksPage() {
  const { t } = useI18n();
  const { data: machinesRaw } = useMachines(apiClient);
  const machines = useMemo(() => toMachineList(machinesRaw), [machinesRaw]);

  const [type, setType] = useState<MachineType | ''>('');
  const [machineId, setMachineId] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [weight, setWeight] = useState(4);
  const [preset, setPreset] = useState<Preset>('lastDay');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machinesOfType = useMemo(
    () => (type ? machines.filter((m) => m.machineType === type) : machines),
    [machines, type],
  );

  const visibleRoutes = useMemo<TrackRoute[]>(
    () =>
      tracks
        .filter((tk) => tk.visible)
        .map((tk) => ({
          id: tk.id,
          points: tk.points,
          color: tk.color,
          weight: tk.weight,
          label: tk.label,
        })),
    [tracks],
  );

  function resolveRange(): { from: string; to: string } | null {
    if (preset === 'custom') {
      if (!customFrom || !customTo) return null;
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() };
    }
    const now = Date.now();
    return {
      from: new Date(now - PRESET_MS[preset]).toISOString(),
      to: new Date(now).toISOString(),
    };
  }

  async function handleShow() {
    if (!machineId) {
      setError(t('tracks.selectMachineFirst'));
      return;
    }
    const range = resolveRange();
    if (!range) {
      setError(t('tracks.error'));
      return;
    }
    const machine = machines.find((m) => m.id === machineId);
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<RouteHistoryResponse>(
        `/api/v1/location/machines/${machineId}/route?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      );
      const points = res.points ?? [];
      if (points.length < 2) {
        setError(t('tracks.noPoints'));
        return;
      }
      const id = `${machineId}|${range.from}|${range.to}|${color}`;
      setTracks((prev) => [
        ...prev.filter((p) => p.id !== id),
        {
          id,
          label: machine ? machineLabel(machine) : machineId,
          color,
          weight,
          from: range.from,
          to: range.to,
          points,
          visible: true,
        },
      ]);
      // Advance to the next distinct palette colour for the following track.
      setColor(PALETTE[(tracks.length + 1) % PALETTE.length]);
    } catch {
      setError(t('tracks.error'));
    } finally {
      setLoading(false);
    }
  }

  const toggle = (id: string) =>
    setTracks((prev) => prev.map((tk) => (tk.id === id ? { ...tk, visible: !tk.visible } : tk)));
  const remove = (id: string) => setTracks((prev) => prev.filter((tk) => tk.id !== id));
  const clearAll = () => setTracks([]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('tracks.title')}
        actions={
          tracks.length > 0 ? (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <Trash2 className="h-4 w-4" />
              {t('tracks.clear')}
            </button>
          ) : undefined
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">{t('tracks.machineType')}</span>
          <select
            className={selectCls}
            value={type}
            onChange={(e) => {
              const next = e.target.value as MachineType | '';
              setType(next);
              // Drop the selected machine if it no longer matches the type.
              if (next && machineId) {
                const m = machines.find((mm) => mm.id === machineId);
                if (m && m.machineType !== next) setMachineId('');
              }
            }}
          >
            <option value="">{t('tracks.allTypes')}</option>
            {Object.values(MachineType).map((mt) => (
              <option key={mt} value={mt}>
                {t(TYPE_LABEL_KEY[mt])}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">{t('tracks.machine')}</span>
          <select
            className={selectCls}
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
          >
            <option value="">{t('tracks.selectMachine')}</option>
            {machinesOfType.map((m) => (
              <option key={m.id} value={m.id}>
                {machineLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">{t('tracks.color')}</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-neutral-200 bg-white p-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">
            {t('tracks.thickness')} ({weight}px)
          </span>
          <input
            type="range"
            min={2}
            max={10}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="h-9 w-28"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">{t('tracks.interval')}</span>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={
                  'rounded-lg border px-2.5 py-1.5 text-xs ' +
                  (preset === p
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50')
                }
              >
                {t(`tracks.${p}`)}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">{t('tracks.from')}</span>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={selectCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">{t('tracks.to')}</span>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className={selectCls}
              />
            </label>
          </>
        )}

        <button
          onClick={handleShow}
          disabled={loading || !machineId}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? t('tracks.loading') : t('tracks.show')}
        </button>

        {error && <span className="self-center text-xs text-red-600">{error}</span>}
      </div>

      {/* Map + legend overlay */}
      <div className="relative h-[68vh] w-full overflow-hidden rounded-xl border border-neutral-200">
        <TracksMap routes={visibleRoutes} className="h-full w-full" />

        {tracks.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center">
            <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs text-neutral-500 shadow">
              {t('tracks.empty')}
            </span>
          </div>
        ) : (
          <div className="absolute right-3 top-3 z-[500] max-h-[60%] w-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 p-3 shadow-lg">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('tracks.legend')}
            </div>
            <ul className="space-y-1.5">
              {tracks.map((tk) => (
                <li key={tk.id} className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => toggle(tk.id)}
                    className="text-neutral-400 hover:text-neutral-700"
                    title={tk.visible ? t('tracks.legend') : t('tracks.legend')}
                  >
                    {tk.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <span
                    className="h-2.5 w-4 shrink-0 rounded"
                    style={{ backgroundColor: tk.color, opacity: tk.visible ? 1 : 0.35 }}
                  />
                  <span
                    className={
                      'flex-1 truncate ' + (tk.visible ? 'text-neutral-800' : 'text-neutral-400')
                    }
                    title={tk.label}
                  >
                    {tk.label}
                    <span className="ml-1 text-xs text-neutral-400">
                      ({t('tracks.points', { n: tk.points.length })})
                    </span>
                  </span>
                  <button
                    onClick={() => remove(tk.id)}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label={t('tracks.clear')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

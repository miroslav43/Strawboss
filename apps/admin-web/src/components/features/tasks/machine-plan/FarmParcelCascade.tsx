'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MapPin, Sprout, Tractor, X } from 'lucide-react';
import type { Parcel } from '@strawboss/types';
import { HarvestStatus } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { HarvestStatusBadge } from '@/components/shared/StatusBadge';

const UNASSIGNED = '__none__';

interface FarmGroup {
  key: string; // farmId, or '__none__' for parcels without a farm
  name: string;
  parcels: Parcel[];
}

/**
 * Cascading farm → parcel picker for the tasks board. Left column lists the farms
 * (grouped client-side from the parcels' denormalized farmName — no extra fetch);
 * clicking a farm shows its parcels beside it, each rendered like the mobile card
 * (code + crop chip + harvest status + locality). Drop-in replacement for the old
 * flat ParcelPicker — still emits a single onSelect(parcelId).
 */
export function FarmParcelCascade({
  parcels,
  excludeParcelIds,
  assignedCountByParcel,
  color,
  onSelect,
  onClose,
}: {
  parcels: Parcel[];
  /** Parcels already on THIS machine — hidden. */
  excludeParcelIds: Set<string>;
  /** How many other machines already work each parcel (for the "already N" badge). */
  assignedCountByParcel: Map<string, number>;
  /** Board accent tailwind color name ('amber' | 'blue' | 'green'). */
  color: string;
  onSelect: (parcelId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [farmSearch, setFarmSearch] = useState('');
  const [parcelSearch, setParcelSearch] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Close when clicking outside the popover.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!wrapRef.current || wrapRef.current.contains(target as Node)) return;
      // A sibling trigger can opt out of outside-close (e.g. the "Select on map"
      // button rendered next to this popover): closing here on `mousedown` would
      // unmount it before its own `click` fires, swallowing the click.
      if (target?.closest('[data-cascade-keep-open]')) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Group the assignable parcels by farm (same filter as the old picker).
  const groups = useMemo<FarmGroup[]>(() => {
    const map = new Map<string, FarmGroup>();
    for (const p of parcels) {
      if (!p.isActive) continue;
      if (excludeParcelIds.has(p.id)) continue;
      const key = p.farmId ?? UNASSIGNED;
      let g = map.get(key);
      if (!g) {
        g = { key, name: p.farmName ?? t('tasks.unassignedFarm'), parcels: [] };
        map.set(key, g);
      }
      g.parcels.push(p);
    }
    const arr = [...map.values()];
    arr.sort((a, b) => {
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      return a.name.localeCompare(b.name, 'ro');
    });
    for (const g of arr) {
      g.parcels.sort((a, b) => (a.code || '').localeCompare(b.code || '', 'ro'));
    }
    return arr;
  }, [parcels, excludeParcelIds, t]);

  const filteredFarms = useMemo(() => {
    const q = farmSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, farmSearch]);

  // Keep a farm selected: default to the first visible one.
  useEffect(() => {
    if (activeKey && filteredFarms.some((g) => g.key === activeKey)) return;
    setActiveKey(filteredFarms[0]?.key ?? null);
    setParcelSearch('');
  }, [filteredFarms, activeKey]);

  const activeGroup = filteredFarms.find((g) => g.key === activeKey) ?? null;

  const filteredParcels = useMemo(() => {
    if (!activeGroup) return [];
    const q = parcelSearch.trim().toLowerCase();
    if (!q) return activeGroup.parcels;
    return activeGroup.parcels.filter((p) =>
      [p.code, p.municipality].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [activeGroup, parcelSearch]);

  return (
    <div
      ref={wrapRef}
      className="absolute left-0 top-full z-50 mt-1 flex rounded-lg border border-neutral-200 bg-white shadow-xl"
    >
      {/* Farms column */}
      <div className="flex w-44 flex-col border-r border-neutral-100">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <input
            type="text"
            autoFocus
            value={farmSearch}
            onChange={(e) => setFarmSearch(e.target.value)}
            placeholder={t('tasks.searchFarms')}
            className="w-full text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
          />
          <button onClick={onClose} className="shrink-0 text-neutral-400 hover:text-neutral-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {filteredFarms.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">{t('tasks.noFarms')}</li>
          ) : (
            filteredFarms.map((g) => {
              const active = g.key === activeKey;
              return (
                <li key={g.key}>
                  <button
                    onClick={() => {
                      setActiveKey(g.key);
                      setParcelSearch('');
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                      active
                        ? 'bg-neutral-100 font-medium text-neutral-900'
                        : 'text-neutral-700 hover:bg-neutral-50',
                    )}
                  >
                    {active ? (
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', `bg-${color}-500`)}
                      />
                    ) : (
                      <Tractor className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    )}
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                      {g.parcels.length}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {/* Parcels column */}
      <div className="flex w-72 flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <input
            type="text"
            value={parcelSearch}
            onChange={(e) => setParcelSearch(e.target.value)}
            placeholder={t('tasks.searchParcels')}
            disabled={!activeGroup}
            className="w-full text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none disabled:opacity-50"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {!activeGroup ? (
            <li className="px-3 py-6 text-center text-xs text-neutral-400">
              {t('tasks.pickFarmFirst')}
            </li>
          ) : filteredParcels.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-400">{t('tasks.noParcelsInFarm')}</li>
          ) : (
            filteredParcels.map((p) => {
              const already = assignedCountByParcel.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      onSelect(p.id);
                      onClose();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-neutral-50"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-neutral-700">
                        {p.code}
                      </span>
                      {p.cropType && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-lime-100 px-1.5 py-0.5 text-[10px] font-semibold text-lime-900">
                          <Sprout className="h-3 w-3 text-lime-700" />
                          {t(`parcels.crop.${p.cropType}`)}
                        </span>
                      )}
                      <HarvestStatusBadge status={p.harvestStatus ?? HarvestStatus.planned} />
                      {already > 0 && (
                        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          <span className={cn('h-1.5 w-1.5 rounded-full', `bg-${color}-500`)} />
                          {t('tasks.alreadyOnParcel', { count: already })}
                        </span>
                      )}
                    </div>
                    {p.municipality && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                        <MapPin className="h-3 w-3 shrink-0 text-neutral-400" />
                        <span className="truncate">{p.municipality}</span>
                      </div>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

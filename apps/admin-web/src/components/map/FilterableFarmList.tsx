'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, X, Search } from 'lucide-react';
import type { Farm, Parcel } from '@strawboss/types';
import { useAssignParcelToFarm } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface FilterableFarmListProps {
  farms: Farm[];
  parcels: Parcel[];
  hiddenFarmIds: Set<string>;
  hiddenParcelIds: Set<string>;
  onToggleFarm: (farmId: string) => void;
  onToggleParcel: (parcelId: string) => void;
}

// ── Compact assign-parcel popover ──────────────────────────────────────────

interface AssignPopoverProps {
  farms: Farm[];
  onAssign: (farmId: string) => void;
  onClose: () => void;
}

function AssignPopover({ farms, onAssign, onClose }: AssignPopoverProps) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return farms;
    return farms.filter((f) => f.name.toLowerCase().includes(lower));
  }, [farms, q]);

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
      {/* Search input */}
      <div className="relative border-b border-neutral-100 p-1.5">
        <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
        <input
          ref={inputRef}
          type="text"
          placeholder={t('mapList.searchFarm')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-md bg-neutral-50 py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {/* Farm list */}
      <ul className="max-h-40 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-neutral-400">{t('mapList.noFarms')}</li>
        ) : (
          filtered.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => { onAssign(f.id); onClose(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 hover:bg-primary/5 hover:text-primary"
              >
                <Plus className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function FilterableFarmList({
  farms,
  parcels,
  hiddenFarmIds,
  hiddenParcelIds,
  onToggleFarm,
  onToggleParcel,
}: FilterableFarmListProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [expandedFarmIds, setExpandedFarmIds] = useState<Set<string>>(new Set());
  const [expandedUnassigned, setExpandedUnassigned] = useState(false);
  // Parcel ID whose assign-popover is open
  const [assignPopoverParcelId, setAssignPopoverParcelId] = useState<string | null>(null);

  const assignParcel = useAssignParcelToFarm(apiClient);

  const toggleFarmExpand = useCallback((farmId: string) => {
    setExpandedFarmIds((prev) => {
      const next = new Set(prev);
      if (next.has(farmId)) next.delete(farmId); else next.add(farmId);
      return next;
    });
  }, []);

  const handleAssignParcel = useCallback(
    (parcelId: string, farmId: string | null) => {
      assignParcel.mutate({ parcelId, farmId });
    },
    [assignParcel],
  );

  const unassignedParcels = useMemo(
    () => parcels.filter((p) => !p.farmId),
    [parcels],
  );

  return (
    <div className="border-t border-neutral-200">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t('mapList.farms')}
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? t('mapList.hide') : t('mapList.show')}
          aria-label={open ? t('mapList.hide') : t('mapList.show')}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="pb-2">
          {/* Empty state */}
          {farms.length === 0 && (
            <p className="px-4 py-3 text-center text-xs text-neutral-400">
              {t('mapList.noFarmsHint')}
            </p>
          )}

          {/* Farm rows */}
          {farms.map((farm) => {
            const farmParcels = parcels.filter((p) => p.farmId === farm.id);
            const isExpanded = expandedFarmIds.has(farm.id);
            const isHidden = hiddenFarmIds.has(farm.id);

            return (
              <div key={farm.id} className="border-b border-neutral-100 last:border-0">
                {/* Farm row */}
                <div className="flex items-center gap-1 px-3 py-1.5 hover:bg-neutral-50">
                  {/* Eye toggle — green = visible, red-muted = hidden */}
                  <button
                    onClick={() => onToggleFarm(farm.id)}
                    className={`flex-shrink-0 rounded p-0.5 transition-colors ${
                      isHidden
                        ? 'text-red-300 hover:text-red-400'
                        : 'text-green-500 hover:text-green-600'
                    }`}
                    title={isHidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                    aria-label={isHidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>

                  {/* Farm name + address */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-neutral-700">{farm.name}</p>
                    {farm.address && (
                      <p className="truncate text-xs text-neutral-400">{farm.address}</p>
                    )}
                  </div>

                  {/* Parcel count badge */}
                  {farmParcels.length > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                      {farmParcels.length}
                    </span>
                  )}

                  {/* Expand/collapse */}
                  <button
                    onClick={() => toggleFarmExpand(farm.id)}
                    className="flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100"
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Farm parcels */}
                {isExpanded && (
                  <div className="bg-neutral-50 pb-1">
                    {farmParcels.length === 0 ? (
                      <p className="px-8 py-2 text-xs text-neutral-400">
                        {t('mapList.noFieldsAssigned')}
                      </p>
                    ) : (
                      farmParcels.map((parcel) => {
                        const parcelHidden = hiddenParcelIds.has(parcel.id);
                        return (
                          <div key={parcel.id} className="flex items-center gap-1 pl-8 pr-3 py-1 hover:bg-neutral-100">
                            {/* Per-parcel eye toggle */}
                            <button
                              onClick={() => onToggleParcel(parcel.id)}
                              className={`flex-shrink-0 rounded p-0.5 transition-colors ${
                                parcelHidden
                                  ? 'text-red-300 hover:text-red-400'
                                  : 'text-green-500 hover:text-green-600'
                              }`}
                              title={parcelHidden ? t('mapList.showField') : t('mapList.hideField')}
                              aria-label={parcelHidden ? t('mapList.showField') : t('mapList.hideField')}
                            >
                              {parcelHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs text-neutral-600">
                                {parcel.name ?? parcel.code}
                              </p>
                              {parcel.areaHectares != null && (
                                <p className="text-xs text-neutral-400">
                                  {parcel.areaHectares} {t('parcels.haUnit')}
                                </p>
                              )}
                            </div>
                            {/* Unassign parcel */}
                            <button
                              onClick={() => handleAssignParcel(parcel.id, null)}
                              className="flex-shrink-0 rounded p-0.5 text-neutral-300 hover:bg-neutral-200 hover:text-red-400"
                              title={t('mapList.removeFromFarm')}
                              aria-label={t('mapList.removeFromFarm')}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned parcels section */}
          {unassignedParcels.length > 0 && (
            <div className="border-t border-dashed border-neutral-200">
              <button
                onClick={() => setExpandedUnassigned((v) => !v)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left hover:bg-neutral-50"
              >
                <span className="flex-1 text-xs text-neutral-400">
                  {t('mapList.unassigned', { count: unassignedParcels.length })}
                </span>
                {expandedUnassigned ? (
                  <ChevronUp className="h-3.5 w-3.5 text-neutral-400" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
                )}
              </button>

              {expandedUnassigned && (
                <div className="bg-neutral-50 pb-1">
                  {unassignedParcels.map((parcel) => {
                    const parcelHidden = hiddenParcelIds.has(parcel.id);
                    const popoverOpen = assignPopoverParcelId === parcel.id;
                    return (
                      <div key={parcel.id} className="relative flex items-center gap-1 pl-6 pr-3 py-1 hover:bg-neutral-100">
                        {/* Eye toggle */}
                        <button
                          onClick={() => onToggleParcel(parcel.id)}
                          className={`flex-shrink-0 rounded p-0.5 transition-colors ${
                            parcelHidden
                              ? 'text-red-300 hover:text-red-400'
                              : 'text-green-500 hover:text-green-600'
                          }`}
                          title={parcelHidden ? t('mapList.showField') : t('mapList.hideField')}
                          aria-label={parcelHidden ? t('mapList.showField') : t('mapList.hideField')}
                        >
                          {parcelHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-neutral-600">
                            {parcel.name ?? parcel.code}
                          </p>
                        </div>

                        {/* Assign to farm — compact popover button */}
                        {farms.length > 0 && (
                          <div className="relative flex-shrink-0">
                            <button
                              onClick={() =>
                                setAssignPopoverParcelId(popoverOpen ? null : parcel.id)
                              }
                              className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                                popoverOpen
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600'
                              }`}
                              title={t('mapList.assignToFarmTooltip')}
                              aria-label={t('mapList.assignToFarmTooltip')}
                            >
                              <Plus className="h-3 w-3" />
                              {t('mapList.assignFarm')}
                            </button>

                            {popoverOpen && (
                              <AssignPopover
                                farms={farms}
                                onAssign={(farmId) => handleAssignParcel(parcel.id, farmId)}
                                onClose={() => setAssignPopoverParcelId(null)}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

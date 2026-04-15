'use client';

import { useState, useMemo, useCallback } from 'react';
import { Crosshair, Route, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import type { MachineLastLocation } from '@strawboss/types';
import { SearchInput } from '@/components/shared/SearchInput';
import { useI18n } from '@/lib/i18n';

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

function isOnline(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() < ONLINE_THRESHOLD_MS;
}

interface FilterableMachineListProps {
  machines: MachineLastLocation[];
  hiddenMachineIds: Set<string>;
  onToggleMachineVisibility: (machineId: string) => void;
  onMachineNavigate: (machine: MachineLastLocation) => void;
  onMachineShowRoute: (machineId: string) => void;
}

export function FilterableMachineList({
  machines,
  hiddenMachineIds,
  onToggleMachineVisibility,
  onMachineNavigate,
  onMachineShowRoute,
}: FilterableMachineListProps) {
  const { t } = useI18n();
  const typeOptions = useMemo(
    () =>
      [
        { value: '', label: t('mapList.allTypes') },
        { value: 'baler', label: t('mapList.typeBaler') },
        { value: 'loader', label: t('mapList.typeLoader') },
        { value: 'truck', label: t('mapList.typeTruck') },
      ] as const,
    [t],
  );
  const statusOptions = useMemo(
    () =>
      [
        { value: '', label: t('mapList.all') },
        { value: 'online', label: t('leaflet.online') },
        { value: 'offline', label: t('leaflet.offline') },
      ] as const,
    [t],
  );
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = useMemo(() => {
    return machines.filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        const matches = [m.machineCode, m.operatorName, m.assignedUserName]
          .some((field) => field?.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (typeFilter && m.machineType !== typeFilter) return false;
      if (statusFilter) {
        const online = isOnline(m.recordedAt);
        if (statusFilter === 'online' && !online) return false;
        if (statusFilter === 'offline' && online) return false;
      }
      return true;
    });
  }, [machines, search, typeFilter, statusFilter]);

  const [open, setOpen] = useState(true);

  const handleSearchChange = useCallback((v: string) => setSearch(v), []);

  if (machines.length === 0) return null;

  return (
    <div className="border-t border-neutral-200">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t('mapList.machines')}
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? t('mapList.hideList') : t('mapList.showList')}
          aria-label={open ? t('mapList.hideList') : t('mapList.showList')}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
      <>
      {/* Filters */}
      <div className="space-y-1.5 border-b border-neutral-100 px-3 py-2">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder={t('mapList.searchMachine')}
        />
        <div className="flex gap-1.5">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="divide-y divide-neutral-100 pb-2">
        {filtered.map((m) => {
          const online = isOnline(m.recordedAt);
          const hidden = hiddenMachineIds.has(m.machineId);
          return (
            <li key={m.machineId} className="px-4 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: online ? '#16a34a' : '#9ca3af' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-700">
                    {m.machineCode ?? m.machineType ?? t('leaflet.machineUnknown')}
                  </p>
                  {m.assignedUserName ? (
                    <p className="truncate text-xs text-emerald-600">{m.assignedUserName}</p>
                  ) : (
                    <p className="truncate text-xs italic text-neutral-300">
                      {t('mapList.noAssignedAccount')}
                    </p>
                  )}
                  {m.operatorName && m.operatorName !== m.assignedUserName && (
                    <p className="truncate text-xs text-neutral-400">
                      {t('mapList.operatorAbbr')} {m.operatorName}
                    </p>
                  )}
                </div>
                {/* Toggle visibility on map */}
                <button
                  onClick={() => onToggleMachineVisibility(m.machineId)}
                  className={`flex-shrink-0 rounded-md p-1 hover:bg-neutral-100 transition-colors ${
                    hidden ? 'text-neutral-300' : 'text-neutral-500'
                  }`}
                  title={hidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                  aria-label={hidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                {/* Navigate to machine */}
                <button
                  onClick={() => onMachineNavigate(m)}
                  className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-500"
                  title={t('mapList.showOnMap')}
                  aria-label={t('mapList.showOnMap')}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
                {/* Show route */}
                <button
                  onClick={() => onMachineShowRoute(m.machineId)}
                  className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-500"
                  title={t('leaflet.showRoute')}
                  aria-label={t('leaflet.showRoute')}
                >
                  <Route className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-center text-xs text-neutral-400">
            {t('mapList.noMachinesMatchFilters')}
          </li>
        )}
      </ul>
      </>
      )}
    </div>
  );
}

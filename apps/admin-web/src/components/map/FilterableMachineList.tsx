'use client';

import { useState, useMemo, useCallback } from 'react';
import { Crosshair, Route } from 'lucide-react';
import type { MachineLastLocation } from '@strawboss/types';
import { SearchInput } from '@/components/shared/SearchInput';

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

const TYPE_OPTIONS = [
  { value: '', label: 'Toate tipurile' },
  { value: 'baler', label: 'Baler' },
  { value: 'loader', label: 'Loader' },
  { value: 'truck', label: 'Camion' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: 'Toate' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
] as const;

function isOnline(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() < ONLINE_THRESHOLD_MS;
}

interface FilterableMachineListProps {
  machines: MachineLastLocation[];
  onMachineNavigate: (machine: MachineLastLocation) => void;
  onMachineShowRoute: (machineId: string) => void;
}

export function FilterableMachineList({
  machines,
  onMachineNavigate,
  onMachineShowRoute,
}: FilterableMachineListProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = useMemo(() => {
    return machines.filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        const matches = [m.machineCode, m.operatorName]
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

  const handleSearchChange = useCallback((v: string) => setSearch(v), []);

  if (machines.length === 0) return null;

  return (
    <div className="border-t border-neutral-200">
      <div className="px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Mașini active
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-1.5 border-b border-neutral-100 px-3 py-2">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Caută mașină…"
        />
        <div className="flex gap-1.5">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 focus:border-primary focus:outline-none"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="divide-y divide-neutral-100 pb-2">
        {filtered.map((m) => {
          const online = isOnline(m.recordedAt);
          return (
            <li key={m.machineId} className="px-4 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: online ? '#16a34a' : '#9ca3af' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-700">
                    {m.machineCode ?? m.machineType ?? 'Mașină'}
                  </p>
                  {m.operatorName && (
                    <p className="truncate text-xs text-neutral-400">{m.operatorName}</p>
                  )}
                </div>
                {/* Navigate to machine */}
                <button
                  onClick={() => onMachineNavigate(m)}
                  className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-500"
                  title="Arată pe hartă"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
                {/* Show route */}
                <button
                  onClick={() => onMachineShowRoute(m.machineId)}
                  className="flex-shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-500"
                  title="Arată traseu"
                >
                  <Route className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-center text-xs text-neutral-400">
            Nicio mașină nu corespunde filtrelor.
          </li>
        )}
      </ul>
    </div>
  );
}

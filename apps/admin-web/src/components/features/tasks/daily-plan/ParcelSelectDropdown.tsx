'use client';

import { useState, useMemo } from 'react';
import { MapPin, ChevronDown, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn, formatAreaHectares } from '@/lib/utils';
import type { Parcel } from '@strawboss/types';

interface ParcelSelectDropdownProps {
  parcels: Parcel[];
  doneParcels: Set<string>;
  selectedParcelId: string | null;
  onSelect: (parcelId: string) => void;
  onOpenMap: () => void;
}

export function ParcelSelectDropdown({
  parcels,
  doneParcels,
  selectedParcelId,
  onSelect,
  onOpenMap,
}: ParcelSelectDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const availableParcels = useMemo(
    () => parcels.filter((p) => p.isActive && !doneParcels.has(p.id)),
    [parcels, doneParcels],
  );

  const filtered = useMemo(() => {
    if (!search) return availableParcels;
    const q = search.toLowerCase();
    return availableParcels.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q) ||
        p.municipality?.toLowerCase().includes(q),
    );
  }, [availableParcels, search]);

  const selectedParcel = parcels.find((p) => p.id === selectedParcelId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-neutral-700">
          {t('tasks.selectParcel')}
        </label>
        <button
          type="button"
          onClick={() => onOpenMap()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary"
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          {t('tasks.selectOnMap')}
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-left text-sm',
            selectedParcelId
              ? 'border-primary/40 text-neutral-800'
              : 'border-neutral-200 text-neutral-500',
          )}
        >
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-neutral-400" />
            {selectedParcel
              ? `${selectedParcel.name ?? selectedParcel.code} (${formatAreaHectares(selectedParcel.areaHectares)} ha)`
              : t('tasks.selectParcel')}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-neutral-400 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="border-b border-neutral-100 p-2">
              <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 text-neutral-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search')}
                  className="w-full bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto p-1">
              {filtered.map((parcel) => {
                const areaHa = formatAreaHectares(parcel.areaHectares);
                return (
                <button
                  key={parcel.id}
                  type="button"
                  onClick={() => {
                    onSelect(parcel.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    parcel.id === selectedParcelId
                      ? 'bg-primary/10 text-primary'
                      : 'text-neutral-700 hover:bg-neutral-50',
                  )}
                >
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{parcel.name ?? parcel.code}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {parcel.code}
                      {areaHa !== '?' ? ` - ${areaHa} ha` : ''}
                      {parcel.municipality ? ` - ${parcel.municipality}` : ''}
                    </p>
                  </div>
                </button>
              );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-center text-xs text-neutral-400">
                  {t('tasks.noParcelResults')}
                </p>
              )}
            </div>

            <div className="border-t border-neutral-100 p-2">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenMap();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 transition-colors hover:border-primary hover:text-primary"
              >
                <MapPin className="h-4 w-4" />
                {t('tasks.selectOnMap')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

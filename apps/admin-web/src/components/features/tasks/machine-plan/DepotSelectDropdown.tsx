'use client';

import { useState, useMemo } from 'react';
import { MapPin, ChevronDown, Search, User, Building2 } from 'lucide-react';
import { useDeliveryDestinations } from '@strawboss/api';
import type { DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { normalizeList as normalize } from '@/lib/normalize-api-list';
import { DepositMapModal } from './DepositMapModal';

interface DepotSelectDropdownProps {
  /** Depots already assigned to THIS machine — hidden from the list/map. */
  excludeDestinationIds?: Set<string>;
  /** Emits the chosen depot id (from the list or the map picker). */
  onSelect: (destinationId: string) => void;
  /** Dismiss the picker without choosing. */
  onClose?: () => void;
  /** Board accent tailwind color name ('amber' | 'blue' | 'green'). */
  color?: string;
}

/**
 * Rich depot picker for the loader/baler task board. Mirrors ParcelSelectDropdown:
 * a toggle button + search box + scrollable list, each option rendering the depot
 * name (bold) + address (MapPin) + contact-person name (User). Also offers a
 * "select on map" button that opens DepositMapModal. Fetches its own depot list
 * via useDeliveryDestinations, filtered to active depots.
 */
export function DepotSelectDropdown({
  excludeDestinationIds,
  onSelect,
  onClose,
  color = 'blue',
}: DepotSelectDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [showMap, setShowMap] = useState(false);

  const { data: rawDeposits } = useDeliveryDestinations(apiClient);
  const deposits = useMemo(() => normalize<DeliveryDestination>(rawDeposits), [rawDeposits]);

  const availableDeposits = useMemo(
    () => deposits.filter((d) => d.isActive && !(excludeDestinationIds?.has(d.id) ?? false)),
    [deposits, excludeDestinationIds],
  );

  const filtered = useMemo(() => {
    if (!search) return availableDeposits;
    const q = search.toLowerCase();
    return availableDeposits.filter(
      (d) =>
        d.name?.toLowerCase().includes(q) ||
        d.code?.toLowerCase().includes(q) ||
        d.address?.toLowerCase().includes(q) ||
        d.contactName?.toLowerCase().includes(q),
    );
  }, [availableDeposits, search]);

  const handlePick = (destinationId: string) => {
    onSelect(destinationId);
    setIsOpen(false);
    setSearch('');
    onClose?.();
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-left text-sm text-neutral-500"
        >
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-neutral-400" />
            {t('tasks.selectDeposit')}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 text-neutral-400 transition-transform', isOpen && 'rotate-180')}
          />
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
              {filtered.map((depot) => (
                <button
                  key={depot.id}
                  type="button"
                  onClick={() => handlePick(depot.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    'text-neutral-700 hover:bg-neutral-50',
                  )}
                >
                  <Building2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium">
                      {depot.name}
                      {depot.code ? (
                        <span className="ml-1 text-xs font-normal text-neutral-400">
                          ({depot.code})
                        </span>
                      ) : null}
                    </p>
                    {depot.address ? (
                      <p className="flex items-center gap-1 truncate text-xs text-neutral-500">
                        <MapPin className="h-3 w-3 flex-shrink-0 text-neutral-400" />
                        <span className="truncate">{depot.address}</span>
                      </p>
                    ) : null}
                    {depot.contactName ? (
                      <p className="flex items-center gap-1 truncate text-xs text-neutral-500">
                        <User className="h-3 w-3 flex-shrink-0 text-neutral-400" />
                        <span className="truncate">{depot.contactName}</span>
                      </p>
                    ) : null}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-center text-xs text-neutral-400">
                  {t('tasks.noDepositAssigned')}
                </p>
              )}
            </div>

            <div className="border-t border-neutral-100 p-2">
              <button
                type="button"
                disabled={availableDeposits.length === 0}
                onClick={() => {
                  setIsOpen(false);
                  setShowMap(true);
                }}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 transition-colors',
                  `hover:border-${color}-400 hover:text-${color}-600`,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <MapPin className="h-4 w-4" />
                {t('tasks.selectDepositOnMap')}
              </button>
            </div>
          </div>
        )}
      </div>

      {showMap && (
        <DepositMapModal
          deposits={availableDeposits}
          onSelect={(destinationId) => {
            handlePick(destinationId);
          }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}

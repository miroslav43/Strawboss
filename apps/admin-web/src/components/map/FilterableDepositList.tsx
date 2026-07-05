'use client';

import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Crosshair,
  Pencil,
  MapPin,
  Trash2,
} from 'lucide-react';
import type { DeliveryDestination } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

interface FilterableDepositListProps {
  deposits: DeliveryDestination[];
  hiddenDepositIds: Set<string>;
  selectedDepositId?: string | null;
  onToggleDeposit: (id: string) => void;
  onNavigate: (deposit: DeliveryDestination) => void;
  onEdit: (deposit: DeliveryDestination) => void;
  onEditBoundary: (deposit: DeliveryDestination) => void;
  onDelete: (id: string) => void;
  deleteIsPending?: boolean;
  /** Optional controlled-collapse state from the parent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Sidebar list of delivery destinations (depots) on the map page.
 *
 * Mirrors the fields list (`FilterableFarmList`) action set — target/fly-to,
 * show/hide, edit info, edit/draw boundary, delete — but as a flat list since
 * depots have no parent grouping. Depots without a drawn boundary are still
 * listed (with a "no boundary" badge); their boundary button starts a fresh
 * draw and their target flies to the point (`coords`) if one exists.
 */
export function FilterableDepositList({
  deposits,
  hiddenDepositIds,
  selectedDepositId,
  onToggleDeposit,
  onNavigate,
  onEdit,
  onEditBoundary,
  onDelete,
  deleteIsPending,
  open: openProp,
  onOpenChange,
}: FilterableDepositListProps) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(true);
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setOpenInternal(next);
    },
    [onOpenChange],
  );

  return (
    <div className="border-t border-neutral-200">
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t('mapList.deposits')}
          </p>
          <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-500">
            {deposits.length}
          </span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          title={open ? t('mapList.hide') : t('mapList.show')}
          aria-label={open ? t('mapList.hide') : t('mapList.show')}
          aria-expanded={open}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="pb-2">
          {deposits.length === 0 ? (
            <p className="px-4 py-3 text-center text-xs text-neutral-400">
              {t('mapList.noDeposits')}
            </p>
          ) : (
            deposits.map((deposit) => {
              const hidden = hiddenDepositIds.has(deposit.id);
              const hasBoundary = !!deposit.boundary;
              const canTarget = hasBoundary || !!deposit.coords;
              return (
                <div
                  key={deposit.id}
                  className={`flex items-center gap-0.5 border-b border-neutral-100 px-3 py-1.5 last:border-0 hover:bg-neutral-50 ${
                    selectedDepositId === deposit.id ? 'bg-amber-50' : ''
                  }`}
                >
                  {/* Eye toggle — blue = visible, red-muted = hidden */}
                  <button
                    onClick={() => onToggleDeposit(deposit.id)}
                    className={`flex-shrink-0 rounded p-0.5 transition-colors ${
                      hidden
                        ? 'text-red-300 hover:text-red-400'
                        : 'text-blue-500 hover:text-blue-600'
                    }`}
                    title={hidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                    aria-label={hidden ? t('mapList.showOnMap') : t('mapList.hideFromMap')}
                  >
                    {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>

                  {/* Depot name + code / no-boundary badge */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-neutral-700">
                      {deposit.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-neutral-400">{deposit.code}</span>
                      {!hasBoundary && (
                        <span className="flex-shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-700">
                          {t('mapList.depositNoBoundary')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Navigate / target */}
                  <button
                    onClick={() => onNavigate(deposit)}
                    disabled={!canTarget}
                    className="flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-blue-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                    title={t('mapList.showOnMap')}
                    aria-label={t('mapList.showOnMap')}
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                  {/* Edit info */}
                  <button
                    onClick={() => onEdit(deposit)}
                    className="flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-primary"
                    title={t('mapList.editDepositInfo')}
                    aria-label={t('mapList.editDepositInfo')}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {/* Edit / draw boundary */}
                  <button
                    onClick={() => onEditBoundary(deposit)}
                    className="flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-blue-600"
                    title={
                      hasBoundary
                        ? t('mapList.editDepositBoundary')
                        : t('mapList.drawDepositBoundary')
                    }
                    aria-label={
                      hasBoundary
                        ? t('mapList.editDepositBoundary')
                        : t('mapList.drawDepositBoundary')
                    }
                  >
                    <MapPin className="h-3 w-3" />
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => onDelete(deposit.id)}
                    disabled={deleteIsPending}
                    className="flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    title={t('mapList.deleteDeposit')}
                    aria-label={t('mapList.deleteDeposit')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

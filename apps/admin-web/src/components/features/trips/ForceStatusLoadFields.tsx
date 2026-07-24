'use client';

import { useMemo } from 'react';
import { Sprout, Warehouse } from 'lucide-react';
import { useParcels, useDeliveryDestinations } from '@strawboss/api';
import type { Parcel, DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { cn } from '@/lib/utils';

export type LoadSource = 'parcel' | 'depot';

export interface ForceStatusLoad {
  source: LoadSource;
  parcelId: string;
  depotId: string;
  baleCount: string;
}

export const EMPTY_LOAD: ForceStatusLoad = {
  source: 'parcel',
  parcelId: '',
  depotId: '',
  baleCount: '',
};

/** True once the admin has said enough for the server to book a real load. */
export function isLoadComplete(v: ForceStatusLoad): boolean {
  const n = Number(v.baleCount);
  if (!Number.isInteger(n) || n <= 0) return false;
  return v.source === 'parcel' ? !!v.parcelId : !!v.depotId;
}

const selectCls =
  'w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-800 ' +
  'focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500';

/**
 * Where the load came from, and how much of it — shown when an admin forces a trip
 * into a status that asserts the goods are on the truck.
 *
 * Without this, forcing a trip to `loaded` produced a phantom: status moved, bale
 * count stayed 0, no source recorded, and stock moved nowhere. The bale_loads row
 * the server writes from these fields IS the stock deduction — parcel remaining is
 * derived as SUM(productions) − SUM(loads), never stored.
 *
 * Parcel or depot, never both: the goods come off a field or out of a yard.
 */
export function ForceStatusLoadFields({
  value,
  onChange,
}: {
  value: ForceStatusLoad;
  onChange: (v: ForceStatusLoad) => void;
}) {
  const { t } = useI18n();
  const { data: rawParcels } = useParcels(apiClient);
  const { data: rawDepots } = useDeliveryDestinations(apiClient);

  const parcels = useMemo(() => normalizeList<Parcel>(rawParcels), [rawParcels]);
  const depots = useMemo(
    () => normalizeList<DeliveryDestination>(rawDepots).filter((d) => d.isActive),
    [rawDepots],
  );

  const patch = (p: Partial<ForceStatusLoad>) => onChange({ ...value, ...p });

  const tab = (source: LoadSource, Icon: typeof Sprout, label: string) => (
    <button
      type="button"
      onClick={() => patch({ source })}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition',
        value.source === source
          ? 'border-amber-600 bg-amber-600 text-white'
          : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-300 bg-white/60 p-3">
      <p className="text-xs font-medium text-amber-900">{t('trip_detail.forceStatus.loadTitle')}</p>

      {/* Source: a field, or a depot. */}
      <div className="flex gap-2">
        {tab('parcel', Sprout, t('trip_detail.forceStatus.sourceParcel'))}
        {tab('depot', Warehouse, t('trip_detail.forceStatus.sourceDepot'))}
      </div>

      {value.source === 'parcel' ? (
        <select
          value={value.parcelId}
          onChange={(e) => patch({ parcelId: e.target.value })}
          className={selectCls}
        >
          <option value="">{t('trip_detail.forceStatus.pickParcel')}</option>
          {parcels.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}
              {p.farmName ? ` — ${p.farmName}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={value.depotId}
          onChange={(e) => patch({ depotId: e.target.value })}
          className={selectCls}
        >
          <option value="">{t('trip_detail.forceStatus.pickDepot')}</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.address ? ` — ${d.address}` : ''}
            </option>
          ))}
        </select>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-amber-900">
          {t('trip_detail.forceStatus.baleCount')}
        </label>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={value.baleCount}
          onChange={(e) => patch({ baleCount: e.target.value })}
          placeholder="0"
          className={selectCls}
        />
        <p className="mt-1 text-[11px] text-amber-700">
          {t('trip_detail.forceStatus.baleCountHint')}
        </p>
      </div>
    </div>
  );
}

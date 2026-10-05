'use client';

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useCreateMeteoReading, useDeleteMeteoReading } from '@strawboss/api';
import type { MeteoMoistureReading, MoistureReadingKind } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { fromLocalInput, toLocalInput, useMeteoFormat } from './format';

const KINDS: MoistureReadingKind[] = ['swath', 'bale'];

/** Manual field reading (a moisture-meter value in %) + the parcel's recent readings. */
export function MoistureReadingForm({
  parcelId,
  readings,
}: {
  parcelId: string;
  readings: MeteoMoistureReading[];
}) {
  const { t } = useI18n();
  const f = useMeteoFormat();
  const create = useCreateMeteoReading(apiClient);
  const remove = useDeleteMeteoReading(apiClient);
  const [value, setValue] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [kind, setKind] = useState<MoistureReadingKind>('swath');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pct = Number(value.replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return setError(t('meteo.reading.valueInvalid'));
    const iso = fromLocalInput(when);
    if (!iso) return setError(t('meteo.reading.timeInvalid'));
    create.mutate(
      {
        // Client-generated id: the endpoint is idempotent on it.
        id: crypto.randomUUID(),
        parcelId,
        measuredAt: iso,
        moisturePct: pct,
        kind,
        source: 'web',
      },
      {
        onSuccess: () => {
          setValue('');
          setWhen(toLocalInput(new Date()));
        },
      },
    );
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-neutral-800">{t('meteo.reading.title')}</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-neutral-700">{t('meteo.reading.value')}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0.1}
            max={99.9}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-neutral-700">{t('meteo.reading.measuredAt')}</span>
          <input
            type="datetime-local"
            required
            value={when}
            max={toLocalInput(new Date())}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-neutral-700">{t('meteo.reading.kind')}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MoistureReadingKind)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`meteo.reading.kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('meteo.reading.add')}
          </button>
        </div>
      </form>
      <p className="mt-2 text-xs text-neutral-400">{t('meteo.reading.hint')}</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {create.isError && <p className="mt-2 text-sm text-red-600">{t('meteo.reading.saveError')}</p>}

      {readings.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 text-sm">
          {readings.slice(0, 10).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-neutral-700">
                <span className="font-medium">{f.pct(r.moistureWb)}</span> · {t(`meteo.reading.kinds.${r.kind}`)}{' '}
                · {f.dateTime(r.measuredAt)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('meteo.reading.deleteConfirm'))) remove.mutate(r.id);
                }}
                disabled={remove.isPending}
                aria-label={t('common.delete')}
                className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

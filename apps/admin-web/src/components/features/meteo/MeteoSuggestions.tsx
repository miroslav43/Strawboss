'use client';

import { Timer } from 'lucide-react';
import type { MeteoHarvestSuggestion } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';

/** "Start the drying clock" list: parcels in the season with no drying clock yet. */
export function MeteoSuggestions({
  suggestions,
  onStart,
}: {
  suggestions: MeteoHarvestSuggestion[];
  onStart: (s: MeteoHarvestSuggestion) => void;
}) {
  const { t } = useI18n();
  const f = useMeteoFormat();
  if (suggestions.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-neutral-800">
        <Timer className="h-4 w-4 text-primary" />
        {t('meteo.suggestions.title')}
      </h2>
      <p className="mb-3 text-xs text-neutral-500">{t('meteo.suggestions.hint')}</p>
      <ul className="divide-y divide-neutral-100">
        {suggestions.map((s) => (
          <li key={s.parcelId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-neutral-800">
                {s.parcelName ?? s.parcelCode ?? s.parcelId}
              </p>
              <p className="text-xs text-neutral-500">
                {t(`parcels.harvest.${s.harvestStatus}`)}
                {s.hintAt && ` · ${t('meteo.suggestions.hintAt', { at: f.dateTime(s.hintAt) })}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onStart(s)}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
            >
              {t('meteo.suggestions.start')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

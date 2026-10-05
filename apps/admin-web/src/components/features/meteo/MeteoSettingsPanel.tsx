'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useMeteoRecompute, useMeteoSettings, useUpdateMeteoSettings } from '@strawboss/api';
import type { MeteoOrgSettings, UpdateMeteoSettingsDto } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Form {
  thresholdPct: string;
  baleableFracMinPct: string;
  rainProbMaxPct: string;
  pressCapacityHaH: string;
  minWindowH: string;
  defaultMc0Pct: string;
  activeDays: string;
}

const pctStr = (x: number) => String(Math.round(x * 1000) / 10);
const toForm = (s: MeteoOrgSettings): Form => ({
  thresholdPct: pctStr(s.thresholdWb),
  baleableFracMinPct: pctStr(s.baleableFracMin),
  rainProbMaxPct: pctStr(s.rainProbMax),
  pressCapacityHaH: String(s.pressCapacityHaH),
  minWindowH: String(s.minWindowH),
  defaultMc0Pct: pctStr(s.defaultMc0Wb),
  activeDays: String(s.activeDays),
});

/** Admin-only org settings: thresholds, press capacity, drying-clock lifetime. */
export function MeteoSettingsPanel() {
  const { t } = useI18n();
  const settings = useMeteoSettings(apiClient);
  const update = useUpdateMeteoSettings(apiClient);
  const recompute = useMeteoRecompute(apiClient);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  if (settings.isLoading || !form) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const dto: UpdateMeteoSettingsDto = {
      thresholdWb: Number(form.thresholdPct) / 100,
      baleableFracMin: Number(form.baleableFracMinPct) / 100,
      rainProbMax: Number(form.rainProbMaxPct) / 100,
      pressCapacityHaH: Number(form.pressCapacityHaH),
      minWindowH: Number(form.minWindowH),
      defaultMc0Wb: Number(form.defaultMc0Pct) / 100,
      activeDays: Number(form.activeDays),
    };
    update.mutate(dto, { onSuccess: () => setSaved(true) });
  };

  const field = (k: keyof Form, label: string, hint: string, step: string, min: number, max: number) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-neutral-700">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        required
        value={form[k]}
        onChange={set(k)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <span className="mt-0.5 block text-xs text-neutral-400">{hint}</span>
    </label>
  );

  return (
    <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-neutral-800">
        <Settings2 className="h-4 w-4 text-primary" />
        {t('meteo.settings.title')}
      </h2>
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field('thresholdPct', t('meteo.settings.threshold'), t('meteo.settings.thresholdHint'), '0.1', 5.1, 39.9)}
          {field('baleableFracMinPct', t('meteo.settings.fracMin'), t('meteo.settings.fracMinHint'), '1', 50, 100)}
          {field('rainProbMaxPct', t('meteo.settings.rainProb'), t('meteo.settings.rainProbHint'), '1', 1, 99)}
          {field('pressCapacityHaH', t('meteo.settings.pressCapacity'), t('meteo.settings.pressCapacityHint'), '0.1', 0.1, 50)}
          {field('minWindowH', t('meteo.settings.minWindow'), t('meteo.settings.minWindowHint'), '1', 1, 24)}
          {field('defaultMc0Pct', t('meteo.settings.defaultMc0'), t('meteo.settings.defaultMc0Hint'), '0.1', 5.1, 69.9)}
          {field('activeDays', t('meteo.settings.activeDays'), t('meteo.settings.activeDaysHint'), '1', 1, 28)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={update.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
            {t('meteo.settings.recompute')}
          </button>
          {saved && <span className="text-sm text-green-600">{t('meteo.settings.saved')}</span>}
          {recompute.isSuccess && (
            <span className="text-sm text-green-600">{t('meteo.settings.recomputeQueued')}</span>
          )}
          {(update.isError || recompute.isError) && (
            <span className="text-sm text-red-600">{t('meteo.settings.error')}</span>
          )}
        </div>
      </form>
    </section>
  );
}

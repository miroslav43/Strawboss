'use client';

import { useEffect, useState } from 'react';
import { BellRing, FlaskConical, Loader2 } from 'lucide-react';
import { useEvaluateMeteoAlerts, useMeteoAlertSettings, useUpdateMeteoAlertSettings } from '@strawboss/api';
import { ALERT_DEFAULTS } from '@strawboss/domain';
import type { MeteoAlertCandidate, MeteoAlertSettings, UpdateMeteoAlertSettingsDto } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';
import { useWeatherFormat } from './weather-format';

type NumKey = 'frostC' | 'heatC' | 'gustMs' | 'rainMm' | 'capeJkg' | 'lookaheadH';
interface Form {
  alertsEnabled: boolean;
  alertsEmail: boolean;
  values: Record<NumKey, string>;
}

/** [key, step, min, max, unit] — ranges mirror `meteo_org_settings_alerts_chk` (migration 00101). */
const FIELDS: [NumKey, string, number, number, string][] = [
  ['frostC', '0.5', -10, 5, '°C'],
  ['heatC', '0.5', 25, 45, '°C'],
  ['gustMs', '0.5', 8, 40, 'm/s'],
  ['rainMm', '1', 5, 200, 'mm'],
  ['capeJkg', '50', 300, 5000, 'J/kg'],
  ['lookaheadH', '1', 24, 48, 'h'],
];

const toForm = (s: MeteoAlertSettings): Form => ({
  alertsEnabled: s.alertsEnabled,
  alertsEmail: s.alertsEmail,
  values: {
    frostC: String(s.frostC),
    heatC: String(s.heatC),
    gustMs: String(s.gustMs),
    rainMm: String(s.rainMm),
    capeJkg: String(s.capeJkg),
    lookaheadH: String(s.lookaheadH),
  },
});

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 hover:bg-neutral-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 rounded border-neutral-300 text-primary" />
      <span>
        <span className="block text-sm font-medium text-neutral-800">{label}</span>
        <span className="block text-xs text-neutral-400">{hint}</span>
      </span>
    </label>
  );
}

/** Admin-only: alert switches + the six thresholds, and a "test now" dry run. */
export function MeteoAlertSettingsPanel() {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const mf = useMeteoFormat();
  const settings = useMeteoAlertSettings(apiClient);
  const update = useUpdateMeteoAlertSettings(apiClient);
  const evaluate = useEvaluateMeteoAlerts(apiClient);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [candidates, setCandidates] = useState<MeteoAlertCandidate[] | null>(null);

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  if (settings.isLoading || !form) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-neutral-400">
        {settings.isError ? (
          <span className="text-red-600">{t('meteo.alertSettings.loadError')}</span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </>
        )}
      </div>
    );
  }

  const setValue = (k: NumKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm({ ...form, values: { ...form.values, [k]: e.target.value } });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const dto: UpdateMeteoAlertSettingsDto = {
      alertsEnabled: form.alertsEnabled,
      alertsEmail: form.alertsEmail,
    };
    for (const [k] of FIELDS) dto[k] = Number(form.values[k]);
    update.mutate(dto, { onSuccess: () => setSaved(true) });
  };

  const unitOf = (type: MeteoAlertCandidate['alertType'], v: number) =>
    type === 'frost' || type === 'heat'
      ? f.temp(v, 1)
      : type === 'wind'
        ? f.kmh(v)
        : type === 'heavy_rain'
          ? f.mm(v)
          : `${f.n0.format(v)} J/kg`;

  return (
    <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-neutral-800">
        <BellRing className="h-4 w-4 text-amber-500" />
        {t('meteo.alertSettings.title')}
      </h2>
      <p className="mb-4 text-xs text-neutral-400">{t('meteo.alertSettings.intro')}</p>
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={form.alertsEnabled}
            onChange={(v) => {
              setSaved(false);
              setForm({ ...form, alertsEnabled: v });
            }}
            label={t('meteo.alertSettings.enabled')}
            hint={t('meteo.alertSettings.enabledHint')}
          />
          <Toggle
            checked={form.alertsEmail}
            onChange={(v) => {
              setSaved(false);
              setForm({ ...form, alertsEmail: v });
            }}
            label={t('meteo.alertSettings.email')}
            hint={t('meteo.alertSettings.emailHint')}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(([k, step, min, max, unit]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">
                {t(`meteo.alertSettings.field.${k}`)} <span className="font-normal text-neutral-400">({unit})</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={step}
                min={min}
                max={max}
                required
                value={form.values[k]}
                onChange={setValue(k)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <span className="mt-0.5 block text-xs text-neutral-400">
                {t('meteo.alertSettings.default', { value: `${ALERT_DEFAULTS[k]} ${unit}` })}
              </span>
            </label>
          ))}
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
            onClick={() => evaluate.mutate({ dryRun: true }, { onSuccess: (r) => setCandidates(r.candidates) })}
            disabled={evaluate.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {evaluate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            {t('meteo.alertSettings.testNow')}
          </button>
          {saved && <span className="text-sm text-green-600">{t('meteo.settings.saved')}</span>}
          {(update.isError || evaluate.isError) && <span className="text-sm text-red-600">{t('meteo.settings.error')}</span>}
        </div>
      </form>

      {candidates && (
        <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('meteo.alertSettings.testResult', { count: candidates.length })}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('meteo.alertSettings.testNone')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm text-neutral-700">
              {candidates.map((c) => (
                <li key={`${c.alertType}-${c.cellKey}-${c.localDay}`} className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.severity === 'severe' ? 'bg-red-600 text-white' : 'bg-amber-200 text-amber-900'}`}>
                    {t(`meteo.alerts.severity.${c.severity}`)}
                  </span>
                  <span className="font-medium">{t(`meteo.alerts.type.${c.alertType}`)}</span>
                  <span className="text-neutral-500">
                    {t('meteo.alerts.valueVs', { value: unitOf(c.alertType, c.peakValue), threshold: unitOf(c.alertType, c.threshold) })}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {mf.time(c.startsAt)} – {mf.time(c.endsAt)} · {t('meteo.alertSettings.parcels', { count: c.parcelCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-neutral-400">{t('meteo.alertSettings.testNote')}</p>
        </div>
      )}
    </section>
  );
}

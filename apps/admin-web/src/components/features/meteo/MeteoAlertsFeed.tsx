'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  BellRing,
  Check,
  CloudLightning,
  CloudRain,
  Loader2,
  ShieldCheck,
  Snowflake,
  ThermometerSun,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { useAckMeteoAlert, useMeteoAlerts } from '@strawboss/api';
import type { MeteoAlert, MeteoAlertType } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useMeteoFormat } from './format';
import { useWeatherFormat } from './weather-format';

const TYPE_ICON: Record<MeteoAlertType, LucideIcon> = {
  frost: Snowflake,
  storm: CloudLightning,
  wind: Wind,
  heavy_rain: CloudRain,
  heat: ThermometerSun,
};
const MAX_PARCEL_LINKS = 3;

/** Alerts of the last 7 days grouped by local day; shown only when `status.alertsEnabled`. */
export function MeteoAlertsFeed() {
  const { t } = useI18n();
  const slug = useOrgSlug();
  const f = useWeatherFormat();
  const mf = useMeteoFormat();
  const alerts = useMeteoAlerts(apiClient, 7);
  const ack = useAckMeteoAlert(apiClient);

  const groups = useMemo(() => {
    const byDay = new Map<string, MeteoAlert[]>();
    for (const a of alerts.data ?? []) {
      const list = byDay.get(a.localDay) ?? [];
      list.push(a);
      byDay.set(a.localDay, list);
    }
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [alerts.data]);

  /** "−2 °C (threshold 0 °C)" in the unit natural to the alert type. */
  const valueText = (a: MeteoAlert): string => {
    switch (a.alertType) {
      case 'frost':
      case 'heat':
        return t('meteo.alerts.valueVs', { value: f.temp(a.peakValue, 1), threshold: f.temp(a.threshold, 1) });
      case 'wind':
        return t('meteo.alerts.valueVs', { value: f.kmh(a.peakValue), threshold: f.kmh(a.threshold) });
      case 'heavy_rain':
        return t('meteo.alerts.valueVs', { value: f.mm(a.peakValue), threshold: f.mm(a.threshold) });
      default:
        return t('meteo.alerts.valueVs', {
          value: `${f.n0.format(a.peakValue)} J/kg`,
          threshold: `${f.n0.format(a.threshold)} J/kg`,
        });
    }
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 bg-gradient-to-r from-amber-50 via-white to-white px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-800">
          <BellRing className="h-4 w-4 text-amber-500" />
          {t('meteo.alerts.title')}
        </h2>
        <span className="text-xs text-neutral-400">{t('meteo.alerts.lastDays', { days: 7 })}</span>
      </div>

      {alerts.isLoading ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : alerts.isError ? (
        <p className="px-5 py-6 text-sm text-red-600">{t('meteo.alerts.loadError')}</p>
      ) : groups.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-neutral-500">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          {t('meteo.alerts.empty')}
        </div>
      ) : (
        <div className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
          {groups.map(([day, list]) => (
            <div key={day} className="px-5 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {f.isToday(day) ? t('meteo.wx.today') : `${f.weekday(day)} ${f.dayMonth(day)}`}
              </p>
              <ul className="space-y-2">
                {list.map((a) => {
                  const Icon = TYPE_ICON[a.alertType];
                  const severe = a.severity === 'severe';
                  const shown = a.parcels.slice(0, MAX_PARCEL_LINKS);
                  const more = Math.max(0, a.parcelCount - shown.length);
                  return (
                    <li
                      key={a.id}
                      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                        a.acknowledgedAt
                          ? 'border-neutral-200 bg-neutral-50 opacity-70'
                          : severe
                            ? 'border-red-200 bg-red-50/60'
                            : 'border-amber-200 bg-amber-50/60'
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          severe ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-800">
                          {t(`meteo.alerts.type.${a.alertType}`)}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              severe ? 'bg-red-600 text-white' : 'bg-amber-200 text-amber-900'
                            }`}
                          >
                            {t(`meteo.alerts.severity.${a.severity}`)}
                          </span>
                          <span className="text-xs font-normal text-neutral-500">{valueText(a)}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {mf.time(a.startsAt)} – {mf.time(a.endsAt)}
                          {' · '}
                          {shown.map((p, i) => (
                            <span key={p.id}>
                              {i > 0 && ', '}
                              <Link href={`/${slug}/meteo/${p.id}`} className="font-medium text-neutral-700 underline-offset-2 hover:underline">
                                {p.name ?? p.code ?? '—'}
                              </Link>
                            </span>
                          ))}
                          {more > 0 && <span> +{more}</span>}
                        </p>
                      </div>
                      {a.acknowledgedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <Check className="h-3.5 w-3.5" />
                          {t('meteo.alerts.acknowledged')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => ack.mutate(a.id)}
                          disabled={ack.isPending && ack.variables === a.id}
                          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {t('meteo.alerts.ack')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {ack.isError && <p className="px-5 pb-3 text-xs text-red-600">{t('meteo.alerts.ackError')}</p>}
    </section>
  );
}

'use client';

import { AlertTriangle, Cloud, Droplets, Sunrise, Sunset, Sun, Thermometer, Wind } from 'lucide-react';
import type { MeteoParcelWeather } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { WeatherIcon, WindArrow } from './weather-icons';
import { useNowMs, useWeatherFormat } from './weather-format';

function Chip({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-2 shadow-sm backdrop-blur"
      title={title}
    >
      <span className="text-neutral-500">{icon}</span>
      <div className="leading-tight">
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
        <p className="text-sm font-semibold text-neutral-800">{value}</p>
      </div>
    </div>
  );
}

/** Large "right now" card: icon, temperature, wind, humidity, sun times, freshness. */
export function WeatherNowCard({ w }: { w: MeteoParcelWeather }) {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const now = useNowMs();
  const c = w.current;
  const today = w.daily[0] ?? null;
  const night = c?.isDay === false;
  const unavailable = t('meteo.wx.unavailable');

  if (!c) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-400 shadow-sm">
        {unavailable}
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border p-5 shadow-sm ${
        night
          ? 'border-slate-200 bg-gradient-to-br from-slate-100 via-slate-100 to-indigo-100'
          : 'border-sky-100 bg-gradient-to-br from-sky-50 via-white to-amber-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/70 shadow-sm">
            <WeatherIcon icon={c.icon} className="h-12 w-12" />
          </div>
          <div>
            <p className="text-5xl font-bold leading-none tracking-tight text-neutral-900">{f.temp(c.tempC, 0)}</p>
            <p className="mt-1 text-sm font-medium text-neutral-600">{t(`meteo.wx.code.${c.icon}`)}</p>
            <p className="text-xs text-neutral-500">
              {t('meteo.wx.feelsLike')} {f.temp(c.apparentC, 0)}
              {today && (
                <>
                  {' · '}
                  {f.deg(today.tMaxC)} / {f.deg(today.tMinC)}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 text-right text-xs text-neutral-500">
          <span>
            {t('meteo.wx.updated')}: {f.ago(w.fetchedAt, now)}
          </span>
          {w.stale && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              {t('meteo.wx.stale')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Chip
          icon={<Wind className="h-4 w-4" />}
          label={t('meteo.wx.wind')}
          title={`${f.ms(c.windMs)} · ${t('meteo.wx.gusts')} ${f.ms(c.gustMs)}`}
          value={
            <span className="inline-flex items-center gap-1">
              {f.kmh(c.windMs)}
              <WindArrow deg={c.windDirDeg} />
            </span>
          }
        />
        <Chip
          icon={<Wind className="h-4 w-4" />}
          label={t('meteo.wx.gusts')}
          title={f.ms(c.gustMs)}
          value={f.kmh(c.gustMs)}
        />
        <Chip icon={<Droplets className="h-4 w-4" />} label={t('meteo.wx.humidity')} value={f.pct(c.rh)} />
        <Chip icon={<Cloud className="h-4 w-4" />} label={t('meteo.wx.clouds')} value={f.pct(c.cloudCover)} />
        <Chip icon={<Thermometer className="h-4 w-4" />} label={t('meteo.wx.precipNow')} value={f.mm(c.precipMm)} />
        <Chip
          icon={<Sun className="h-4 w-4" />}
          label={t('meteo.wx.daylight')}
          value={today ? f.hours(today.daylightH) : unavailable}
        />
      </div>

      {today && (today.sunrise || today.sunset) && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1.5">
            <Sunrise className="h-4 w-4 text-amber-500" />
            {t('meteo.wx.sunrise')} {f.clock(today.sunrise)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sunset className="h-4 w-4 text-orange-500" />
            {t('meteo.wx.sunset')} {f.clock(today.sunset)}
          </span>
          {today.sunshineH !== null && (
            <span>
              {t('meteo.wx.sunshine')} {f.hours(today.sunshineH)}
            </span>
          )}
          {today.uvMax !== null && (
            <span>
              {t('meteo.wx.uv')} {f.n1.format(today.uvMax)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

'use client';

import { useMemo } from 'react';
import { CloudOff, Loader2, MapPinOff } from 'lucide-react';
import { useMeteoParcelWeather } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { WxCard } from './WxCard';
import { WeatherNowCard } from './WeatherNowCard';
import { AgroIndicatorCards } from './AgroIndicatorCards';
import { Weather48hChart } from './Weather48hChart';
import { DailyForecastStrip } from './DailyForecastStrip';
import { SoilCard } from './SoilCard';

function Notice({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 py-10 text-sm text-neutral-500">
      {icon}
      {text}
    </div>
  );
}

/**
 * Premium weather block for ANY parcel (no drying clock needed): now, agro
 * indicators, 48 h chart, 16-day strip, soil and climatology. Every card
 * tolerates nulls from the source.
 */
export function ParcelWeatherSection({ parcelId }: { parcelId: string }) {
  const { t } = useI18n();
  const q = useMeteoParcelWeather(apiClient, parcelId, 'full');
  const w = q.data;

  const sprayWindows = useMemo(() => w?.agro?.spray.windows ?? [], [w]);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('meteo.wx.loading')}
        </div>
        <div className="h-44 animate-pulse rounded-2xl bg-neutral-100" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError || !w) {
    return <Notice icon={<CloudOff className="h-4 w-4" />} text={t('meteo.wx.loadError')} />;
  }
  if (!w.location) {
    return <Notice icon={<MapPinOff className="h-4 w-4" />} text={t('meteo.wx.noLocation')} />;
  }
  // The backend answered but the weather source did not (nothing cached yet):
  // one clear notice instead of a page of empty cards. Retried automatically.
  if (!w.current && w.hourly.length === 0 && w.daily.length === 0) {
    return <Notice icon={<CloudOff className="h-4 w-4" />} text={t('meteo.wx.upstreamDown')} />;
  }

  return (
    <div className="space-y-4">
      <WeatherNowCard w={w} />

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{t('meteo.agro.title')}</h2>
        <AgroIndicatorCards agro={w.agro} />
      </div>

      <WxCard title={t('meteo.wx.chart.title')}>
        <Weather48hChart hours={w.hourly} sprayWindows={sprayWindows} />
        <p className="mt-1 text-[11px] text-neutral-400">{t('meteo.wx.chart.legend')}</p>
      </WxCard>

      <WxCard title={t('meteo.wx.daily.title')}>
        <DailyForecastStrip days={w.daily} />
      </WxCard>

      <SoilCard hours={w.hourly} />

      <p className="text-[11px] text-neutral-400">{w.attribution}</p>
    </div>
  );
}

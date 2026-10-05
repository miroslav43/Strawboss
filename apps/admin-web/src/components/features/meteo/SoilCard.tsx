'use client';

import { Droplet, Leaf, Sprout, Thermometer } from 'lucide-react';
import type { MeteoWeatherHour } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { WxCard } from './WxCard';
import { useWeatherFormat } from './weather-format';

function Stat({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted: string;
}) {
  const empty = value === '—';
  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5">
      <span className="text-emerald-600">{icon}</span>
      <div className="leading-tight">
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
        <p className={`text-sm font-semibold ${empty ? 'font-normal text-neutral-400' : 'text-neutral-800'}`}>
          {empty ? muted : value}
        </p>
      </div>
    </div>
  );
}

/** Soil temperature and moisture, VPD and leaf wetness for the current hour (null-tolerant). */
export function SoilCard({ hours }: { hours: MeteoWeatherHour[] }) {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const h = hours[0] ?? null;
  const minSoil = hours.reduce<number | null>(
    (m, x) => (x.soilTemp0C === null ? m : m === null ? x.soilTemp0C : Math.min(m, x.soilTemp0C)),
    null,
  );
  const na = t('meteo.wx.unavailable');

  return (
    <WxCard title={t('meteo.wx.soil.title')} icon={<Sprout className="h-4 w-4 text-emerald-600" />}>
      {!h ? (
        <p className="text-sm text-neutral-400">{na}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<Thermometer className="h-4 w-4" />} label={t('meteo.wx.soil.temp')} value={f.temp(h.soilTemp0C, 1)} muted={na} />
          <Stat icon={<Thermometer className="h-4 w-4" />} label={t('meteo.wx.soil.minTemp')} value={f.temp(minSoil, 1)} muted={na} />
          <Stat icon={<Droplet className="h-4 w-4" />} label={t('meteo.wx.soil.moist0')} value={f.pct(h.soilMoist0to1)} muted={na} />
          <Stat icon={<Droplet className="h-4 w-4" />} label={t('meteo.wx.soil.moist3')} value={f.pct(h.soilMoist3to9)} muted={na} />
          <Stat
            icon={<Leaf className="h-4 w-4" />}
            label={t('meteo.wx.soil.vpd')}
            value={h.vpdKPa === null ? '—' : `${f.n1.format(h.vpdKPa)} kPa`}
            muted={na}
          />
          <Stat icon={<Leaf className="h-4 w-4" />} label={t('meteo.wx.soil.leafWet')} value={f.pct(h.leafWetProb)} muted={na} />
        </div>
      )}
    </WxCard>
  );
}

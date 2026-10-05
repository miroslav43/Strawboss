'use client';

import { useMemo } from 'react';
import { Droplets, Wind } from 'lucide-react';
import type { MeteoWeatherDay } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { WeatherIcon } from './weather-icons';
import { useWeatherFormat } from './weather-format';

/** 16 day cards, horizontally scrollable; temperature bar is normalised over the whole range. */
export function DailyForecastStrip({ days }: { days: MeteoWeatherDay[] }) {
  const { t } = useI18n();
  const f = useWeatherFormat();

  const { lo, span } = useMemo(() => {
    const mins = days.map((d) => d.tMinC).filter((v): v is number => v !== null);
    const maxs = days.map((d) => d.tMaxC).filter((v): v is number => v !== null);
    const lo = mins.length ? Math.min(...mins) : 0;
    const hi = maxs.length ? Math.max(...maxs) : 1;
    return { lo, span: Math.max(1, hi - lo) };
  }, [days]);

  if (days.length === 0) {
    return <div className="py-6 text-center text-sm text-neutral-400">{t('meteo.wx.unavailable')}</div>;
  }

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {days.map((d) => {
        const frost = d.tMinC !== null && d.tMinC <= 0;
        const heat = d.tMaxC !== null && d.tMaxC >= 32;
        const left = d.tMinC === null ? 0 : ((d.tMinC - lo) / span) * 100;
        const right = d.tMaxC === null ? 100 : ((d.tMaxC - lo) / span) * 100;
        const today = f.isToday(d.date);
        return (
          <div
            key={d.date}
            className={`flex w-[5.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center ${
              f.isWeekend(d.date) ? 'bg-neutral-50' : 'bg-white'
            } ${
              frost
                ? 'border-sky-300 ring-2 ring-sky-200'
                : heat
                  ? 'border-red-300 ring-2 ring-red-200'
                  : today
                    ? 'border-primary/40'
                    : 'border-neutral-200'
            }`}
            title={`${t(`meteo.wx.code.${d.icon}`)}${d.gustMaxMs !== null ? ` · ${f.ms(d.gustMaxMs)}` : ''}`}
          >
            <p className="text-xs font-semibold text-neutral-700">{today ? t('meteo.wx.today') : f.weekday(d.date)}</p>
            <p className="-mt-1 text-[10px] text-neutral-400">{f.dayMonth(d.date)}</p>
            <WeatherIcon icon={d.icon} className="h-7 w-7" />
            <div className="w-full">
              <div className="flex justify-between text-[11px] font-medium">
                <span className="text-sky-600">{f.deg(d.tMinC)}</span>
                <span className="text-red-500">{f.deg(d.tMaxC)}</span>
              </div>
              <div className="relative mt-1 h-1.5 w-full rounded-full bg-neutral-100">
                <div
                  className="absolute h-1.5 rounded-full bg-gradient-to-r from-sky-400 to-red-400"
                  style={{ left: `${left}%`, width: `${Math.max(6, right - left)}%` }}
                />
              </div>
            </div>
            <p className="flex items-center gap-1 text-[11px] text-sky-700">
              <Droplets className="h-3 w-3" />
              {f.n1.format(d.precipMm ?? 0)} mm
            </p>
            <p className="-mt-1 text-[10px] text-neutral-400">{f.pct(d.precipProbMax)}</p>
            <p className="flex items-center gap-1 text-[11px] text-violet-600" title={f.ms(d.gustMaxMs)}>
              <Wind className="h-3 w-3" />
              {f.kmh(d.gustMaxMs)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

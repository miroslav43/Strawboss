'use client';

import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2, Sprout, Thermometer, TrendingDown, TrendingUp } from 'lucide-react';
import { useMeteoParcelClimate } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { WxCard } from './WxCard';
import { useWeatherFormat } from './weather-format';

function Delta({ value, unit, digits = 1 }: { value: number | null; unit: string; digits?: 0 | 1 }) {
  const f = useWeatherFormat();
  if (value === null) return <span className="text-neutral-400">—</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${value === 0 ? 'text-neutral-500' : up ? 'text-orange-600' : 'text-sky-600'}`}>
      {value !== 0 && <Icon className="h-3.5 w-3.5" />}
      {f.signed(value, digits)} {unit}
    </span>
  );
}

function Block({ title, children, footnote, tip }: { title: string; children: React.ReactNode; footnote?: string; tip?: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3" title={tip}>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{title}</p>
      <div className="mt-1 space-y-0.5 text-sm text-neutral-700">{children}</div>
      {footnote && <p className="mt-1 text-[11px] text-neutral-400">{footnote}</p>}
    </div>
  );
}

/**
 * ERA5 climatology vs. the current season. Hidden when the archive is not
 * configured, the feature is off (403) or the parcel has no location — an
 * absent card, not a disabled one.
 */
export function ClimateCard({ parcelId }: { parcelId: string }) {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const q = useMeteoParcelClimate(apiClient, parcelId);
  const c = q.data;

  const chart = useMemo(
    () =>
      (c?.monthlyNormals ?? []).map((m) => ({
        month: f.monthShort(m.month),
        precip: Math.round(m.precipMm),
        tmean: Math.round(m.tmeanC * 10) / 10,
      })),
    [c, f],
  );

  if (q.isError) {
    const status = (q.error as { status?: number } | null)?.status;
    if (status === 403) return null;
    return (
      <WxCard title={t('meteo.climate.title')} icon={<Thermometer className="h-4 w-4 text-orange-500" />}>
        <p className="text-sm text-neutral-400">{t('meteo.wx.unavailable')}</p>
      </WxCard>
    );
  }
  if (q.isLoading) {
    return (
      <WxCard title={t('meteo.climate.title')} icon={<Thermometer className="h-4 w-4 text-orange-500" />}>
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      </WxCard>
    );
  }
  if (!c || c.status === 'not_configured' || c.status === 'no_location') return null;

  if (c.status === 'pending') {
    return (
      <WxCard title={t('meteo.climate.title')} icon={<Thermometer className="h-4 w-4 text-orange-500" />}>
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm text-amber-800">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          {t('meteo.climate.pending')}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100" />
          ))}
        </div>
      </WxCard>
    );
  }

  const mtd = c.monthToDate;
  const l30 = c.last30;
  const gdd = c.gdd;
  const mtdTempDelta = mtd && mtd.tmeanC !== null && mtd.normalTmeanC !== null ? mtd.tmeanC - mtd.normalTmeanC : null;
  const mtdRainPct =
    mtd && mtd.precipMm !== null && mtd.normalPrecipMm !== null && mtd.normalPrecipMm > 0
      ? (mtd.precipMm / mtd.normalPrecipMm - 1) * 100
      : null;
  const currentMonth = mtd?.month ?? null;

  return (
    <WxCard
      title={t('meteo.climate.title')}
      icon={<Thermometer className="h-4 w-4 text-orange-500" />}
      right={<span className="text-[11px] text-neutral-400">{c.sourceNote}</span>}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Block
          title={t('meteo.climate.monthToDate')}
          footnote={mtd ? t('meteo.climate.daysCovered', { count: mtd.days }) : undefined}
        >
          {mtd ? (
            <>
              <p>
                {f.temp(mtd.tmeanC, 1)} <span className="text-xs text-neutral-400">{t('meteo.climate.vsNormal')}</span>{' '}
                <Delta value={mtdTempDelta} unit="°C" />
              </p>
              <p>
                {f.mm(mtd.precipMm)} <span className="text-xs text-neutral-400">{t('meteo.climate.vsNormal')}</span>{' '}
                <Delta value={mtdRainPct} unit="%" digits={0} />
              </p>
            </>
          ) : (
            <p className="text-neutral-400">{t('meteo.wx.unavailable')}</p>
          )}
        </Block>
        <Block
          title={t('meteo.climate.last30')}
          footnote={l30 ? t('meteo.climate.daysCovered', { count: l30.daysCovered }) : undefined}
        >
          {l30 ? (
            <>
              <p>
                {f.temp(l30.tmeanC, 1)} <span className="text-xs text-neutral-400">{t('meteo.climate.vsNormal')}</span>{' '}
                <Delta value={l30.anomalyC} unit="°C" />
              </p>
              <p>
                {f.mm(l30.precipMm)} <span className="text-xs text-neutral-400">{t('meteo.climate.vsNormal')}</span>{' '}
                <Delta value={l30.precipPct === null ? null : l30.precipPct - 100} unit="%" digits={0} />
              </p>
            </>
          ) : (
            <p className="text-neutral-400">{t('meteo.wx.unavailable')}</p>
          )}
        </Block>
        <Block
          title={t('meteo.climate.gdd')}
          tip={gdd ? t('meteo.climate.gddTip', { base: gdd.baseC, start: f.dayMonth(gdd.start) }) : undefined}
          footnote={gdd ? t('meteo.climate.gddBasis', { base: gdd.baseC }) : undefined}
        >
          {gdd && gdd.value !== null ? (
            <>
              <p className="flex items-center gap-1.5">
                <Sprout className="h-4 w-4 text-emerald-600" />
                <span className="text-lg font-bold text-neutral-900">{f.n0.format(gdd.value)}</span>
                <span className="text-xs text-neutral-400">°C·d</span>
              </p>
              <p>
                {t('meteo.climate.normal')} {gdd.normal === null ? '—' : f.n0.format(gdd.normal)}{' '}
                <Delta value={gdd.anomalyPct} unit="%" digits={0} />
              </p>
            </>
          ) : (
            <p className="text-neutral-400">{t('meteo.wx.unavailable')}</p>
          )}
        </Block>
      </div>

      {chart.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">{t('meteo.climate.normalsChart')}</p>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="mm" tick={{ fontSize: 11 }} unit="mm" width={48} />
              <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} unit="°" width={36} />
              <Tooltip
                formatter={(value, _n, item) => [
                  `${value} ${(item as { dataKey?: string }).dataKey === 'precip' ? 'mm' : '°C'}`,
                  (item as { dataKey?: string }).dataKey === 'precip' ? t('meteo.climate.precipLabel') : t('meteo.wx.chart.temp'),
                ]}
              />
              <Bar yAxisId="mm" dataKey="precip" fill="#93c5fd" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="c" type="monotone" dataKey="tmean" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          {currentMonth !== null && (
            <p className="mt-1 text-[11px] text-neutral-400">
              {t('meteo.climate.normalsNote', { period: c.period })}
            </p>
          )}
        </div>
      )}
    </WxCard>
  );
}

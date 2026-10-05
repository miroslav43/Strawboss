'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MeteoSprayWindow, MeteoWeatherHour } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';
import { useNowMs } from './weather-format';

const HOUR_MS = 3_600_000;
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Contiguous [fromMs, toMs] runs where `pred(hour)` holds. */
function runs(hours: MeteoWeatherHour[], pred: (h: MeteoWeatherHour) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (const h of hours) {
    const ts = Date.parse(h.time);
    if (pred(h)) {
      if (start === null) start = ts;
      last = ts;
    } else if (start !== null) {
      out.push([start, last + HOUR_MS]);
      start = null;
    }
  }
  if (start !== null) out.push([start, last + HOUR_MS]);
  return out;
}

/** Next 48 h: temperature, rain (bars + probability), gusts; night shaded, spray windows banded. */
export function Weather48hChart({
  hours,
  sprayWindows,
}: {
  hours: MeteoWeatherHour[];
  sprayWindows: MeteoSprayWindow[];
}) {
  const { t } = useI18n();
  const f = useMeteoFormat();

  const data = useMemo(
    () =>
      hours.map((h) => ({
        ts: Date.parse(h.time),
        temp: r1(h.tempC),
        precip: h.precipMm === null ? null : Math.round(h.precipMm * 100) / 100,
        prob: h.precipProb === null ? null : Math.round(h.precipProb * 100),
        gust: h.gustMs === null ? null : Math.round(h.gustMs * 3.6),
      })),
    [hours],
  );
  const nights = useMemo(() => runs(hours, (h) => h.isDay === false), [hours]);
  const maxPrecip = useMemo(() => Math.max(2, ...data.map((d) => d.precip ?? 0)), [data]);
  // Ticks every minute so the "now" line follows real time on an open page.
  const nowTs = Math.floor(useNowMs() / HOUR_MS) * HOUR_MS;

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-neutral-400">{t('meteo.chart.noData')}</div>;
  }

  const unitFor = (key: string) => (key === 'temp' ? ' °C' : key === 'precip' ? ' mm' : key === 'prob' ? ' %' : ' km/h');

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        {nights.map(([a, b]) => (
          <ReferenceArea key={`n${a}`} yAxisId="temp" x1={a} x2={b} fill="#64748b" fillOpacity={0.1} stroke="none" />
        ))}
        {sprayWindows.map((w) => (
          <ReferenceArea
            key={`s${w.start}`}
            yAxisId="temp"
            x1={Date.parse(w.start)}
            x2={Date.parse(w.end)}
            fill="#22c55e"
            fillOpacity={0.16}
            stroke="#22c55e"
            strokeOpacity={0.4}
          />
        ))}
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => f.axis(v)}
          tick={{ fontSize: 11 }}
          minTickGap={40}
        />
        <YAxis yAxisId="temp" unit="°" tick={{ fontSize: 12 }} width={44} />
        <YAxis yAxisId="prob" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} width={44} />
        <YAxis yAxisId="mm" hide domain={[0, maxPrecip * 3]} />
        <YAxis yAxisId="kmh" hide domain={[0, 'auto']} />
        <Tooltip
          labelFormatter={(v) => f.axis(Number(v))}
          formatter={(value, name, item) => [
            `${value ?? '—'}${unitFor(String((item as { dataKey?: string }).dataKey ?? ''))}`,
            name,
          ]}
        />
        <Legend />
        <Bar
          yAxisId="mm"
          dataKey="precip"
          name={t('meteo.chart.precip')}
          fill="#3b82f6"
          fillOpacity={0.85}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="prob"
          type="stepAfter"
          dataKey="prob"
          name={t('meteo.chart.rainProb')}
          stroke="#0ea5e9"
          strokeWidth={1.5}
          strokeOpacity={0.7}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          yAxisId="kmh"
          type="monotone"
          dataKey="gust"
          name={t('meteo.wx.chart.gust')}
          stroke="#8b5cf6"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="temp"
          name={t('meteo.wx.chart.temp')}
          stroke="#ef4444"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <ReferenceLine yAxisId="temp" x={nowTs} stroke="#111827" strokeDasharray="4 3" label={{ value: t('meteo.chart.now'), fontSize: 11, position: 'insideTopLeft' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

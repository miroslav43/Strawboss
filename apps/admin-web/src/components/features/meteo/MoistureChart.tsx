'use client';

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MeteoHourPoint, MeteoMoistureReading } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';

interface MoistureChartProps {
  hours: MeteoHourPoint[];
  thresholdWb: number;
  readings: MeteoMoistureReading[];
}

interface Datum {
  ts: number;
  band: [number, number] | null;
  observed: number | null;
  forecast: number | null;
}

const HOUR = 3_600_000;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Contiguous runs of `true` flags as [startMs, endMs] (end = last hour + 1h). */
function runs(points: MeteoHourPoint[], pick: (p: MeteoHourPoint) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  let prev = 0;
  for (const p of points) {
    const ts = Date.parse(p.time);
    if (pick(p)) {
      if (start === null) start = ts;
      prev = ts;
    } else if (start !== null) {
      out.push([start, prev]);
      start = null;
    }
  }
  if (start !== null) out.push([start, prev]);
  return out;
}

/**
 * Straw-moisture chart, wet basis in %: p10–p90 band, p50 line (solid where
 * observed, dashed where forecast), threshold line, baleable hours shaded
 * green, dew hours marked, field readings as dots, "now" marker.
 */
export function MoistureChart({ hours, thresholdWb, readings }: MoistureChartProps) {
  const { t } = useI18n();
  const f = useMeteoFormat();

  const { data, observedEnd, baleable, dew, readingDots, yMax } = useMemo(() => {
    const data: Datum[] = [];
    let observedEnd: number | null = null;
    let lastObserved: Datum | null = null;
    let top = thresholdWb * 100 + 5;
    for (const p of hours) {
      const ts = Date.parse(p.time);
      const p50 = p.p50 === null ? null : r1(p.p50 * 100);
      const band: [number, number] | null =
        p.p10 !== null && p.p90 !== null ? [r1(p.p10 * 100), r1(p.p90 * 100)] : null;
      if (band) top = Math.max(top, band[1]);
      const d: Datum = {
        ts,
        band,
        observed: p.observed ? p50 : null,
        forecast: p.observed ? null : p50,
      };
      if (p.observed) {
        observedEnd = ts;
        lastObserved = d;
      } else if (lastObserved && lastObserved.forecast === null) {
        // Join the dashed forecast line to the solid observed one.
        lastObserved.forecast = lastObserved.observed;
        lastObserved = null;
      }
      data.push(d);
    }
    const readingDots = readings.map((r) => ({
      ts: Date.parse(r.measuredAt),
      value: r1(r.moistureWb * 100),
      kind: r.kind,
    }));
    for (const r of readingDots) top = Math.max(top, r.value);
    return {
      data,
      observedEnd,
      baleable: runs(hours, (p) => p.baleable),
      dew: hours.filter((p) => p.dew).map((p) => Date.parse(p.time)),
      readingDots,
      yMax: Math.ceil(top + 2),
    };
  }, [hours, readings, thresholdWb]);

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-neutral-400">{t('meteo.chart.noData')}</div>;
  }

  const first = data[0].ts;
  const last = data[data.length - 1].ts;
  const dewPoints = dew.map((ts) => ({ ts, value: 0.6 }));
  const now = Date.now();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={[first, last + HOUR]}
          tickFormatter={(v: number) => f.axis(v)}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          domain={[0, yMax]}
          unit=" %"
          tick={{ fontSize: 12 }}
          allowDecimals={false}
        />
        <Tooltip
          labelFormatter={(v) => f.axis(Number(v))}
          formatter={(value, name) => {
            const v = Array.isArray(value) ? `${value[0]} – ${value[1]}` : String(value);
            return [`${v} %`, name];
          }}
        />
        <Legend />
        {observedEnd !== null && (
          <ReferenceArea x1={first} x2={observedEnd} fill="#9ca3af" fillOpacity={0.12} ifOverflow="extendDomain" />
        )}
        {baleable.map(([a, b], i) => (
          <ReferenceArea
            key={`${a}-${i}`}
            x1={a}
            x2={b + HOUR}
            fill="#16a34a"
            fillOpacity={0.15}
            ifOverflow="extendDomain"
          />
        ))}
        <Area
          type="monotone"
          dataKey="band"
          name={t('meteo.chart.band')}
          stroke="none"
          fill="#3b82f6"
          fillOpacity={0.2}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="observed"
          name={t('meteo.chart.observed')}
          stroke="#1d4ed8"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="forecast"
          name={t('meteo.chart.forecast')}
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <ReferenceLine
          y={r1(thresholdWb * 100)}
          stroke="#dc2626"
          strokeDasharray="4 4"
          label={{ value: t('meteo.chart.threshold'), fontSize: 11, fill: '#dc2626', position: 'insideTopRight' }}
        />
        <ReferenceLine x={now} stroke="#525252" label={{ value: t('meteo.chart.now'), fontSize: 11, position: 'top' }} />
        <Scatter
          name={t('meteo.chart.dew')}
          data={dewPoints}
          dataKey="value"
          fill="#0ea5e9"
          shape="diamond"
          isAnimationActive={false}
        />
        <Scatter
          name={t('meteo.chart.readings')}
          data={readingDots}
          dataKey="value"
          fill="#f59e0b"
          stroke="#92400e"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

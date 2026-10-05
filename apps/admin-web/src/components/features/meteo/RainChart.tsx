'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MeteoHourPoint } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';

/** Precipitation (mm/h bars) and rain probability (% line). */
export function RainChart({ hours }: { hours: MeteoHourPoint[] }) {
  const { t } = useI18n();
  const f = useMeteoFormat();

  const data = useMemo(
    () =>
      hours.map((p) => ({
        ts: Date.parse(p.time),
        precip: p.precipMm === null ? null : Math.round(p.precipMm * 100) / 100,
        prob: p.rainProb === null ? null : Math.round(p.rainProb * 100),
      })),
    [hours],
  );

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-neutral-400">{t('meteo.chart.noData')}</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => f.axis(v)}
          tick={{ fontSize: 11 }}
        />
        <YAxis yAxisId="mm" unit=" mm" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="prob" orientation="right" domain={[0, 100]} unit=" %" tick={{ fontSize: 12 }} />
        <Tooltip labelFormatter={(v) => f.axis(Number(v))} />
        <Legend />
        <Bar
          yAxisId="mm"
          dataKey="precip"
          name={t('meteo.chart.precip')}
          fill="#3b82f6"
          isAnimationActive={false}
        />
        <Line
          yAxisId="prob"
          type="stepAfter"
          dataKey="prob"
          name={t('meteo.chart.rainProb')}
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

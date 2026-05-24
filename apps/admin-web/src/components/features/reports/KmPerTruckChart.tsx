'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '@/lib/i18n';

/** One row per date — additional keys are per-machine `km` values. */
export interface KmChartRow {
  date: string;
  [machineCode: string]: string | number;
}

interface KmPerTruckChartProps {
  data: KmChartRow[];
  machines: { code: string; color: string }[];
}

/** Grouped bar chart — x = date, one bar series per selected machine. */
export function KmPerTruckChart({ data, machines }: KmPerTruckChartProps) {
  const { t } = useI18n();

  if (data.length === 0 || machines.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.kmPerTruck.empty')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          label={{ value: 'km', angle: -90, position: 'insideLeft', fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number) =>
            `${typeof value === 'number' ? value.toFixed(2) : value} km`
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {machines.map((m) => (
          <Bar key={m.code} dataKey={m.code} fill={m.color} stackId={undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

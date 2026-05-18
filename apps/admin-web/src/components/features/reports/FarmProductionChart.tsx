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
import type { FarmReport } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

interface FarmProductionChartProps {
  data: FarmReport[];
}

/** Grouped bar chart: produced / loaded / delivered per farm. */
export function FarmProductionChart({ data }: FarmProductionChartProps) {
  const { t } = useI18n();

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.common.noData')}
      </div>
    );
  }

  const chartData = data.map((f) => ({
    name: f.farmName,
    produced: f.produced,
    loaded: f.loaded,
    delivered: f.delivered,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar
          dataKey="produced"
          name={t('reports.farms.produced')}
          fill="#4f7942"
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="loaded"
          name={t('reports.farms.loaded')}
          fill="#3b82f6"
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="delivered"
          name={t('reports.farms.delivered')}
          fill="#f59e0b"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

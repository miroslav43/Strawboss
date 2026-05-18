'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '@/lib/i18n';

export interface RankingDatum {
  name: string;
  value: number;
}

interface RankingBarChartProps {
  data: RankingDatum[];
  color?: string;
}

/** Horizontal bar chart used by the rankings tab. */
export function RankingBarChart({ data, color = '#4f7942' }: RankingBarChartProps) {
  const { t } = useI18n();

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.common.noData')}
      </div>
    );
  }

  const height = Math.max(data.length * 38 + 24, 120);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fontSize: 12 }}
        />
        <Tooltip />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

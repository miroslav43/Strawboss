'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { DepotReport } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

const PIE_COLORS = [
  '#4f7942',
  '#3b82f6',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#ef4444',
  '#6366f1',
];

interface DepotStockChartProps {
  data: DepotReport[];
}

/** Pie chart of total-stock distribution across depots. */
export function DepotStockChart({ data }: DepotStockChartProps) {
  const { t } = useI18n();

  const pieData = data
    .filter((d) => d.totalStock > 0)
    .map((d) => ({ name: d.depotName, value: d.totalStock }));

  if (pieData.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.common.noData')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label
        >
          {pieData.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

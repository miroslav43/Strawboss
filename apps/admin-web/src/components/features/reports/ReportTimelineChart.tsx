'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportTimelinePoint } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';

interface ReportTimelineChartProps {
  data: ReportTimelinePoint[];
}

/** Line chart of produced / loaded / delivered bales over the date range. */
export function ReportTimelineChart({ data }: ReportTimelineChartProps) {
  const { t } = useI18n();

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        {t('reports.common.noData')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="produced"
          name={t('reports.timeline.produced')}
          stroke="#4f7942"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="loaded"
          name={t('reports.timeline.loaded')}
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="delivered"
          name={t('reports.timeline.delivered')}
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

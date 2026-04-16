'use client';

import { cn } from '@/lib/utils';

export interface OperatorProductionRow {
  operatorId?: string;
  operatorName?: string;
  totalBales?: number;
  [key: string]: unknown;
}

interface OperatorProductionChartProps {
  data: OperatorProductionRow[];
  className?: string;
}

export function OperatorProductionChart({ data, className }: OperatorProductionChartProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        Nu sunt date de productie pentru operatori
      </div>
    );
  }

  const sorted = [...data].sort(
    (a, b) => (Number(b.totalBales) || 0) - (Number(a.totalBales) || 0),
  );

  const maxBales = Math.max(...sorted.map((d) => Number(d.totalBales) || 0), 1);

  return (
    <div className={cn('space-y-3', className)}>
      {sorted.map((row, idx) => {
        const bales = Number(row.totalBales) || 0;
        const percent = maxBales > 0 ? (bales / maxBales) * 100 : 0;

        return (
          <div
            key={row.operatorId ?? idx}
            className="rounded-lg border border-neutral-100 bg-white p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-800">
                {row.operatorName ?? 'N/A'}
              </span>
              <span className="text-sm font-semibold text-neutral-700">
                {bales} baloti
              </span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

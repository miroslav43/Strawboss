'use client';

import { cn } from '@/lib/utils';

export interface OperatorStat {
  operatorId?: string;
  operatorName?: string;
  totalBales?: number;
  [key: string]: unknown;
}

interface TopOperatorsProps {
  data: OperatorStat[];
  className?: string;
}

export function TopOperators({ data, className }: TopOperatorsProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        Nu sunt date disponibile
      </div>
    );
  }

  const sorted = [...data]
    .sort((a, b) => (Number(b.totalBales) || 0) - (Number(a.totalBales) || 0))
    .slice(0, 5);

  const maxBales = Math.max(...sorted.map((o) => Number(o.totalBales) || 0), 1);

  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-800">
        Top operatori azi
      </h2>
      <div className="space-y-3">
        {sorted.map((op, idx) => {
          const bales = Number(op.totalBales) || 0;
          const percent = maxBales > 0 ? (bales / maxBales) * 100 : 0;
          return (
            <div key={op.operatorId ?? idx} className="flex items-center gap-3">
              <span className="w-6 text-right text-sm font-bold text-neutral-400">
                {idx + 1}
              </span>
              <span className="w-28 truncate text-sm font-medium text-neutral-800">
                {op.operatorName ?? 'N/A'}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-semibold text-neutral-700">
                {bales}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

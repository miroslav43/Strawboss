'use client';

import type { TrendingDay } from '@strawboss/api';
import { cn } from '@/lib/utils';

interface TrendingChartProps {
  data: TrendingDay[];
  className?: string;
}

const DAY_LABELS: Record<number, string> = {
  0: 'Dum',
  1: 'Lun',
  2: 'Mar',
  3: 'Mie',
  4: 'Joi',
  5: 'Vin',
  6: 'Sam',
};

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return DAY_LABELS[d.getDay()] ?? '?';
}

export function TrendingChart({ data, className }: TrendingChartProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        Nu sunt date disponibile
      </div>
    );
  }

  const maxBales = Math.max(...data.map((d) => d.bales), 1);

  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-800">
        Productie ultimele 7 zile
      </h2>
      <div className="space-y-3">
        {data.map((day) => {
          const percent = maxBales > 0 ? (day.bales / maxBales) * 100 : 0;
          return (
            <div key={day.date} className="flex items-center gap-3">
              <span className="w-10 text-right text-sm font-medium text-neutral-500">
                {getDayLabel(day.date)}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-green-600 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-12 text-right text-sm font-semibold text-neutral-700">
                {day.bales}
              </span>
            </div>
          );
        })}
      </div>

      {/* Trip completion summary */}
      <div className="mt-4 flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" /> Baloti
        </span>
        <span>
          Curse finalizate:{' '}
          <span className="font-medium text-neutral-700">
            {data.reduce((sum, d) => sum + d.tripsCompleted, 0)}
          </span>
        </span>
      </div>
    </div>
  );
}

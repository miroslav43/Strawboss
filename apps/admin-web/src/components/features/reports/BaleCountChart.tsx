'use client';

import type { ProductionReport } from '@strawboss/types';
import { cn } from '@/lib/utils';

interface BaleCountChartProps {
  data: ProductionReport[];
  className?: string;
}

export function BaleCountChart({ data, className }: BaleCountChartProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        No production data available
      </div>
    );
  }

  const maxVal = Math.max(
    ...data.flatMap((d) => [d.produced, d.loaded, d.delivered]),
    1,
  );

  return (
    <div className={cn('space-y-4', className)}>
      {data.map((row) => (
        <div key={row.parcelId} className="rounded-lg border border-neutral-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-800">
              {row.parcelName}
            </span>
            <span className="text-xs text-neutral-500">
              Loss: {row.lossPercentage.toFixed(1)}%
            </span>
          </div>
          <div className="space-y-1.5">
            <BarRow
              label="Produced"
              value={row.produced}
              max={maxVal}
              color="bg-green-500"
            />
            <BarRow
              label="Loaded"
              value={row.loaded}
              max={maxVal}
              color="bg-blue-500"
            />
            <BarRow
              label="Delivered"
              value={row.delivered}
              max={maxVal}
              color="bg-amber-500"
            />
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" /> Produced
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" /> Loaded
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> Delivered
        </span>
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const percent = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-right text-[11px] text-neutral-500">
        {label}
      </span>
      <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 text-right text-[11px] font-medium text-neutral-700">
        {value}
      </span>
    </div>
  );
}

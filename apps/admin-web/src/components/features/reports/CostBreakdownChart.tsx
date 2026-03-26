'use client';

import type { CostReport } from '@strawboss/types';
import { cn } from '@/lib/utils';

interface CostBreakdownChartProps {
  data: CostReport[];
  className?: string;
}

export function CostBreakdownChart({ data, className }: CostBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-neutral-400">
        No cost data available
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.totalCost), 1);

  return (
    <div className={cn('space-y-3', className)}>
      {data.map((row) => {
        const fuelPercent = maxCost > 0 ? (row.fuelCost / maxCost) * 100 : 0;
        const consumablePercent =
          maxCost > 0 ? (row.consumableCost / maxCost) * 100 : 0;

        return (
          <div
            key={row.entityId}
            className="rounded-lg border border-neutral-100 bg-white p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-neutral-800">
                  {row.entityName}
                </span>
                <span className="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                  {row.entityType}
                </span>
              </div>
              <span className="text-sm font-semibold text-neutral-700">
                ${row.totalCost.toLocaleString()}
              </span>
            </div>

            {/* Stacked bar */}
            <div className="flex h-5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-orange-500 transition-all"
                style={{ width: `${fuelPercent}%` }}
                title={`Fuel: $${row.fuelCost.toLocaleString()}`}
              />
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${consumablePercent}%` }}
                title={`Consumables: $${row.consumableCost.toLocaleString()}`}
              />
            </div>

            <div className="mt-1.5 flex gap-4 text-[11px] text-neutral-500">
              <span>Fuel: ${row.fuelCost.toLocaleString()}</span>
              <span>Consumables: ${row.consumableCost.toLocaleString()}</span>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500" /> Fuel
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-500" /> Consumables
        </span>
      </div>
    </div>
  );
}

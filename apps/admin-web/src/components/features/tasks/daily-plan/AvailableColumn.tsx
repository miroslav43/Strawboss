'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/react';
import { CircleDot, Container, Truck, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DraggablePlanCard, type PlanMachine } from './DraggablePlanCard';

interface AvailableColumnProps {
  machines: PlanMachine[];
}

const typeOrder = ['baler', 'loader', 'truck'] as const;

const typeIcons: Record<string, typeof Truck> = {
  baler: CircleDot,
  loader: Container,
  truck: Truck,
};

const typeLabels: Record<string, string> = {
  baler: 'tasks.balers',
  loader: 'tasks.loaders',
  truck: 'tasks.trucks',
};

const typeColors: Record<string, string> = {
  baler: 'text-amber-600',
  loader: 'text-blue-600',
  truck: 'text-green-600',
};

export function AvailableColumn({ machines }: AvailableColumnProps) {
  const { t } = useI18n();
  const { ref, isDropTarget } = useDroppable({ id: 'available' });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = new Map<string, PlanMachine[]>();
  for (const type of typeOrder) {
    const items = machines.filter((m) => m.machineType === type);
    if (items.length > 0) grouped.set(type, items);
  }

  return (
    <div
      className={cn(
        'flex w-72 flex-shrink-0 flex-col rounded-lg border bg-neutral-50',
        isDropTarget
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-neutral-200',
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-neutral-700">{t('tasks.available')}</h3>
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
          {machines.length}
        </span>
      </div>

      {/* Groups */}
      <div ref={ref} className="flex-1 overflow-y-auto p-2" style={{ minHeight: 80 }}>
        {grouped.size === 0 && (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
            {t('tasks.allAssigned')}
          </div>
        )}

        {Array.from(grouped.entries()).map(([type, items]) => {
          const Icon = typeIcons[type] ?? Truck;
          const isCollapsed = collapsed[type] ?? false;
          return (
            <div key={type} className="mb-2 last:mb-0">
              <button
                onClick={() => setCollapsed((p) => ({ ...p, [type]: !p[type] }))}
                className="mb-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:bg-neutral-100"
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />
                }
                <Icon className={cn('h-3 w-3', typeColors[type])} />
                <span>{t(typeLabels[type] ?? type)}</span>
                <span className="ml-auto text-[10px] font-normal text-neutral-400">
                  {items.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="space-y-1.5">
                  {items.map((machine) => (
                    <DraggablePlanCard
                      key={machine.id}
                      machine={machine}
                      columnId="available"
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

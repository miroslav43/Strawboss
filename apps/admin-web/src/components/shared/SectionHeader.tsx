'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The delimiter between the two ledgers on the Curse page.
 *
 * Sticky, so that while you scroll a long fleet list you never lose track of
 * which table you are reading — the whole point of merging the two pages was to
 * put them side by side without letting them blur into one another.
 */
export function SectionHeader({
  title,
  hint,
  count,
  actions,
  tone = 'neutral',
  icon: Icon,
}: {
  title: string;
  hint?: string;
  count?: number;
  actions?: React.ReactNode;
  tone?: 'neutral' | 'amber';
  icon?: LucideIcon;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-neutral-50/95 px-1 py-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && (
          <Icon
            className={cn(
              'h-4 w-4 shrink-0',
              tone === 'amber' ? 'text-amber-600' : 'text-neutral-400',
            )}
          />
        )}
        <h2
          className={cn(
            'truncate text-sm font-semibold',
            tone === 'amber' ? 'text-amber-800' : 'text-neutral-800',
          )}
        >
          {title}
        </h2>
        {count !== undefined && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              tone === 'amber'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-neutral-200/70 text-neutral-600',
            )}
          >
            {count}
          </span>
        )}
        {hint && (
          <span className="hidden truncate text-xs text-neutral-400 sm:inline">· {hint}</span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

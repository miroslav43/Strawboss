'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KpiTrend {
  /** Absolute or percentage delta — caller decides the unit. */
  delta: number;
  direction: 'up' | 'down' | 'flat';
  /** Optional label suffix, e.g. "% vs yesterday". Caller provides i18n string. */
  label?: string;
}

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subtitle?: string;
  /** Optional trend badge rendered below the value. */
  trend?: KpiTrend;
  className?: string;
}

export function KpiCard({ icon: Icon, label, value, subtitle, trend, className }: KpiCardProps) {
  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
          <p className="mt-2 text-3xl font-bold text-neutral-800">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-neutral-400">{subtitle}</p>}
          {trend && <KpiTrendBadge trend={trend} />}
        </div>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function KpiTrendBadge({ trend }: { trend: KpiTrend }) {
  const isUp = trend.direction === 'up';
  const isDown = trend.direction === 'down';
  const isFlat = trend.direction === 'flat';

  const colorCls = isUp ? 'text-green-600' : isDown ? 'text-red-500' : 'text-neutral-400';

  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  const sign = trend.delta > 0 ? '+' : trend.delta < 0 ? '' : '';
  const displayDelta = isFlat
    ? '0'
    : `${sign}${trend.delta > 0 ? trend.delta : Math.abs(trend.delta)}`;

  return (
    <span
      className={cn('mt-1.5 inline-flex items-center gap-1 text-xs font-medium', colorCls)}
      aria-label={`${isUp ? 'increase' : isDown ? 'decrease' : 'no change'}: ${displayDelta}${trend.label ?? ''}`}
    >
      <TrendIcon className="h-3 w-3" aria-hidden="true" />
      {displayDelta}
      {trend.label && <span className="font-normal text-neutral-400">{trend.label}</span>}
    </span>
  );
}

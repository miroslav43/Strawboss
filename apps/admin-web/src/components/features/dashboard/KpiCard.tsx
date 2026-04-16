'use client';

import { cn } from '@/lib/utils';

interface KpiCardProps {
  icon: string;
  label: string;
  value: number | string;
  subtitle?: string;
  className?: string;
}

export function KpiCard({ icon, label, value, subtitle, className }: KpiCardProps) {
  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold text-neutral-800">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-neutral-400">{subtitle}</p>
          )}
        </div>
        <span className="text-2xl" role="img" aria-label={label}>
          {icon}
        </span>
      </div>
    </div>
  );
}

'use client';

import type { TrendingDay } from '@strawboss/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useLocaleFormat } from '@/lib/use-locale-format';

interface TrendingChartProps {
  data: TrendingDay[];
  className?: string;
}

/**
 * Short weekday label for `dateStr`'s OWN day — replaces a hand-rolled
 * `dashboard.days.*` table (7 keys per locale) that just reimplemented what
 * `Intl.DateTimeFormat(locale, { weekday: 'short' })` already does. No
 * `timeZone` override on purpose: it must label whatever day `new Date(dateStr)`
 * resolves to in the viewer's own timezone, matching the previous
 * `DAY_KEYS[d.getDay()]` lookup exactly (0 = Sunday) rather than assuming a
 * week start.
 */
function getDayLabel(dateStr: string, localeTag: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat(localeTag, { weekday: 'short' }).format(d);
}

export function TrendingChart({ data, className }: TrendingChartProps) {
  const { t } = useI18n();
  const fmt = useLocaleFormat();

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-neutral-400">{t('dashboard.noData')}</div>;
  }

  const maxBales = Math.max(...data.map((d) => d.bales), 1);

  return (
    <div className={cn('rounded-xl bg-white p-6 shadow-sm', className)}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-800">
        {t('dashboard.productionLast7Days')}
      </h2>
      <div className="space-y-3">
        {data.map((day) => {
          const percent = maxBales > 0 ? (day.bales / maxBales) * 100 : 0;
          return (
            <div key={day.date} className="flex items-center gap-3">
              <span className="w-10 text-right text-sm font-medium text-neutral-500">
                {getDayLabel(day.date, fmt.tag)}
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
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" />{' '}
          {t('dashboard.bales')}
        </span>
        <span>
          {t('dashboard.tripsCompletedLabel')}{' '}
          <span className="font-medium text-neutral-700">
            {data.reduce((sum, d) => sum + d.tripsCompleted, 0)}
          </span>
        </span>
      </div>
    </div>
  );
}

'use client';

import { Calendar } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface DayNavigatorProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return formatDate(new Date());
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

export function DayNavigator({ selectedDate, onDateChange }: DayNavigatorProps) {
  const { t, locale } = useI18n();
  const today = getToday();
  const tomorrow = getTomorrow();

  const displayDate = new Date(selectedDate + 'T12:00:00');
  const formattedDate = displayDate.toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-neutral-200 bg-white">
        <button
          onClick={() => onDateChange(today)}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors first:rounded-l-lg',
            selectedDate === today
              ? 'bg-primary text-white'
              : 'text-neutral-600 hover:bg-neutral-50',
          )}
        >
          {t('tasks.today')}
        </button>
        <button
          onClick={() => onDateChange(tomorrow)}
          className={cn(
            'border-l border-neutral-200 px-4 py-2 text-sm font-medium transition-colors last:rounded-r-lg',
            selectedDate === tomorrow
              ? 'bg-primary text-white'
              : 'text-neutral-600 hover:bg-neutral-50',
          )}
        >
          {t('tasks.tomorrow')}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-neutral-400" />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <span className="text-sm text-neutral-500">
        {t('tasks.planningFor')}{' '}
        <span className="font-medium text-neutral-700">{formattedDate}</span>
      </span>
    </div>
  );
}

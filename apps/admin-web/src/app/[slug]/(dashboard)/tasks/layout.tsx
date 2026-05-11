'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Eye, CircleDot, Container, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DayNavigator } from '@/components/features/tasks/daily-plan/DayNavigator';
import { useI18n } from '@/lib/i18n';
import { TasksDateContext } from './tasks-date-context';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

const tabs = [
  { href: '/tasks',         icon: Eye,       labelKey: 'tasks.overview' as const, color: 'text-neutral-600' },
  { href: '/tasks/balers',  icon: CircleDot, labelKey: 'tasks.balerTasks' as const, color: 'text-amber-600' },
  { href: '/tasks/loaders', icon: Container, labelKey: 'tasks.loaderTasks' as const, color: 'text-blue-600' },
  { href: '/tasks/trucks',  icon: Truck,     labelKey: 'tasks.truckTasks' as const, color: 'text-green-600' },
];

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));

  return (
    <TasksDateContext.Provider value={{ selectedDate, setSelectedDate }}>
      <div className="flex flex-col gap-4 p-6">
        <DayNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

        {/* Tab bar */}
        <nav className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1">
          {tabs.map((tab) => {
            const isActive =
              tab.href === '/tasks'
                ? pathname === '/tasks'
                : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-neutral-600 hover:bg-neutral-50',
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-white' : tab.color)} />
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </TasksDateContext.Provider>
  );
}

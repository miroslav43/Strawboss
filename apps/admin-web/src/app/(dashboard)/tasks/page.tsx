'use client';
export const dynamic = 'force-dynamic';

import { useMemo } from 'react';
import { CircleDot, Container, Truck, Loader2, Eye } from 'lucide-react';
import { useDailyPlan } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTasksDate } from './tasks-date-context';

function normalize<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const r = raw as { data?: T[] } | null | undefined;
  return r?.data ?? [];
}

interface OverviewAssignment {
  id: string;
  machineId: string;
  machineCode?: string;
  machineType?: string;
  registrationPlate?: string;
  parcelId: string | null;
  parcelName?: string | null;
  parcelCode?: string | null;
  destinationName?: string | null;
  status: string;
}

function StatusColumn({
  title,
  items,
  color,
}: {
  title: string;
  items: OverviewAssignment[];
  color: string;
}) {
  const { t } = useI18n();

  const machineColor = (type: string | undefined) => {
    switch (type) {
      case 'baler': return 'bg-amber-100 text-amber-700';
      case 'loader': return 'bg-blue-100 text-blue-700';
      case 'truck': return 'bg-green-100 text-green-700';
      default: return 'bg-neutral-100 text-neutral-700';
    }
  };

  const machineLabel = (type: string | undefined) => {
    switch (type) {
      case 'baler': return t('tasks.balers');
      case 'loader': return t('tasks.loaders');
      case 'truck': return t('tasks.trucks');
      default: return '';
    }
  };

  return (
    <div>
      <div className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 ${color}`}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-center text-xs text-neutral-400 py-8">—</p>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${machineColor(a.machineType)}`}>
                  {machineLabel(a.machineType)}
                </span>
                <span className="text-sm font-medium text-neutral-800">
                  {a.machineCode || '—'}
                </span>
              </div>
              {a.parcelName && (
                <p className="mt-1 text-xs text-neutral-500">
                  → {a.parcelName} {a.parcelCode ? `(${a.parcelCode})` : ''}
                </p>
              )}
              {a.destinationName && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  → {a.destinationName}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TasksOverviewPage() {
  const { t } = useI18n();
  const { selectedDate } = useTasksDate();
  const { data: rawPlan, isLoading } = useDailyPlan(apiClient, selectedDate);

  const plan = rawPlan as {
    available?: { machine: OverviewAssignment }[];
    inProgress?: { assignments: OverviewAssignment[] }[];
    done?: OverviewAssignment[];
  } | null;

  // Flatten in-progress assignments from parcel groups
  const allInProgress = useMemo(() => {
    if (!plan?.inProgress) return [];
    const flat: OverviewAssignment[] = [];
    const extract = (items: OverviewAssignment[]) => {
      for (const item of items) {
        flat.push(item);
        const children = (item as unknown as { children?: OverviewAssignment[] }).children;
        if (children) extract(children);
      }
    };
    for (const group of plan.inProgress) {
      extract(group.assignments ?? []);
    }
    return flat;
  }, [plan]);

  const doneList = useMemo(() => normalize<OverviewAssignment>(plan?.done), [plan]);
  const availableList = useMemo(
    () => (plan?.available ?? []).map((a) => ({ ...a.machine, status: 'available' })),
    [plan],
  );

  // Summary counts by machine type
  const summary = useMemo(() => {
    const all = [...availableList, ...allInProgress, ...doneList];
    const count = (type: string) => new Set(all.filter((a) => a.machineType === type).map((a) => a.machineId)).size;
    return {
      balers: count('baler'),
      loaders: count('loader'),
      trucks: count('truck'),
    };
  }, [availableList, allInProgress, doneList]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  const isEmpty = availableList.length === 0 && allInProgress.length === 0 && doneList.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <Eye className="h-10 w-10 mb-3 opacity-20" />
        <p className="text-sm font-medium">{t('tasks.overviewEmpty')}</p>
        <p className="mt-1 text-xs">{t('tasks.overviewHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <CircleDot className="h-5 w-5 text-amber-500" />
          <div>
            <p className="text-lg font-bold text-neutral-900">{summary.balers}</p>
            <p className="text-xs text-neutral-500">{t('tasks.summaryBalers')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <Container className="h-5 w-5 text-blue-500" />
          <div>
            <p className="text-lg font-bold text-neutral-900">{summary.loaders}</p>
            <p className="text-xs text-neutral-500">{t('tasks.summaryLoaders')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <Truck className="h-5 w-5 text-green-500" />
          <div>
            <p className="text-lg font-bold text-neutral-900">{summary.trucks}</p>
            <p className="text-xs text-neutral-500">{t('tasks.summaryTrucks')}</p>
          </div>
        </div>
      </div>

      {/* 3-column status board */}
      <div className="grid grid-cols-3 gap-6">
        <StatusColumn
          title={t('tasks.planned')}
          items={availableList}
          color="bg-neutral-100 text-neutral-700"
        />
        <StatusColumn
          title={t('tasks.inProgress')}
          items={allInProgress}
          color="bg-blue-100 text-blue-700"
        />
        <StatusColumn
          title={t('tasks.done')}
          items={doneList}
          color="bg-green-100 text-green-700"
        />
      </div>
    </div>
  );
}

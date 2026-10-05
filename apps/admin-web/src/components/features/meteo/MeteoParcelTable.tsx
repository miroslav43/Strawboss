'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { MeteoFarmCell, MeteoOverviewRow } from '@strawboss/types';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { STATUS_STYLES, useMeteoFormat } from './format';
import { useWeatherFormat } from './weather-format';

interface MeteoRow extends MeteoOverviewRow, Record<string, unknown> {}

/** Overview table. No default sort: the server order IS the status + urgency order. */
export function MeteoParcelTable({
  rows,
  weatherByParcel,
}: {
  rows: MeteoOverviewRow[];
  /** Farm-map cell per parcel (joined by cellKey in the page); absent = columns hidden. */
  weatherByParcel?: Map<string, MeteoFarmCell>;
}) {
  const { t } = useI18n();
  const f = useMeteoFormat();
  const wf = useWeatherFormat();
  const router = useRouter();
  const slug = useOrgSlug();

  const data = useMemo<MeteoRow[]>(() => rows.map((r) => ({ ...r })), [rows]);

  const cropLabel = (c: string | null) => {
    if (!c) return '—';
    const key = `parcels.crop.${c}`;
    const label = t(key);
    return label === key ? c : label;
  };

  const columns: Column<MeteoRow>[] = [
    {
      key: 'parcelName',
      header: t('meteo.col.parcel'),
      sortable: true,
      sortValue: (r) => r.parcelName ?? r.parcelCode ?? '',
      render: (r) => (
        <span className="flex items-center gap-2">
          <span
            className={`h-3 w-3 shrink-0 rounded-full ${STATUS_STYLES[r.status].dot}`}
            title={t(`meteo.status.${r.status}`)}
          />
          <span className="font-medium text-neutral-800">{r.parcelName ?? r.parcelCode ?? '—'}</span>
        </span>
      ),
    },
    { key: 'cropType', header: t('meteo.col.crop'), sortable: true, render: (r) => cropLabel(r.cropType) },
    {
      key: 'harvestedAt',
      header: t('meteo.col.harvestedAt'),
      sortable: true,
      render: (r) => f.dateTime(r.harvestedAt),
    },
    {
      key: 'mcP50',
      header: t('meteo.col.moisture'),
      sortable: true,
      sortValue: (r) => r.mcP50 ?? -1,
      render: (r) =>
        r.mcP50 === null ? (
          '—'
        ) : (
          <span className="whitespace-nowrap">
            {f.pct(r.mcP50)}{' '}
            <span className="text-xs text-neutral-400">
              [{f.pct(r.mcP10)} – {f.pct(r.mcP90)}]
            </span>
          </span>
        ),
    },
    {
      key: 'windowStart',
      header: t('meteo.col.window'),
      sortable: true,
      sortValue: (r) => r.window.start ?? '',
      render: (r) =>
        r.window.start && r.window.end ? `${f.time(r.window.start)} – ${f.time(r.window.end)}` : '—',
    },
    {
      key: 'message',
      header: t('meteo.col.message'),
      render: (r) => (r.reasons.length > 0 ? f.reasonText(r.reasons[0]) : '—'),
    },
    {
      key: 'lastReadingAt',
      header: t('meteo.col.lastReading'),
      sortable: true,
      sortValue: (r) => r.lastReadingAt ?? '',
      render: (r) =>
        r.lastReadingAt ? `${f.pct(r.lastReadingWb)} · ${f.time(r.lastReadingAt)}` : '—',
    },
    ...(weatherByParcel
      ? ([
          {
            key: 'tempNow',
            header: t('meteo.col.tempNow'),
            sortable: true,
            sortValue: (r) => weatherByParcel.get(r.parcelId)?.tempNowC ?? -999,
            render: (r) => wf.temp(weatherByParcel.get(r.parcelId)?.tempNowC, 1),
          },
          {
            key: 'rain24h',
            header: t('meteo.col.rain24h'),
            sortable: true,
            sortValue: (r) => weatherByParcel.get(r.parcelId)?.rain24hMm ?? -1,
            render: (r) => wf.mm(weatherByParcel.get(r.parcelId)?.rain24hMm),
          },
        ] satisfies Column<MeteoRow>[])
      : []),
    {
      key: 'dataAgeH',
      header: t('meteo.col.dataAge'),
      sortable: true,
      sortValue: (r) => r.dataAgeH ?? -1,
      render: (r) => f.hours(r.dataAgeH),
    },
  ];

  return (
    <DataTable<MeteoRow>
      columns={columns}
      data={data}
      keyExtractor={(r) => r.harvestEventId}
      rowClassName={(r) => `cursor-pointer ${STATUS_STYLES[r.status].row}`}
      onRowClick={(r) => router.push(`/${slug}/meteo/${r.parcelId}`)}
      emptyMessage={t('meteo.table.empty')}
    />
  );
}

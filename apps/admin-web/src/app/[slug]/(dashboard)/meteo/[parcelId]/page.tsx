'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, Pencil, Timer } from 'lucide-react';
import { useMeteoParcel, useMeteoReadings, useMeteoStatus } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { MeteoStatusGate } from '@/components/features/meteo/MeteoStatusGate';
import { MeteoReasons } from '@/components/features/meteo/MeteoReasons';
import { MoistureChart } from '@/components/features/meteo/MoistureChart';
import { RainChart } from '@/components/features/meteo/RainChart';
import { HarvestEventEditor } from '@/components/features/meteo/HarvestEventEditor';
import { MoistureReadingForm } from '@/components/features/meteo/MoistureReadingForm';
import { FingerprintList } from '@/components/features/meteo/FingerprintList';
import { ParcelWeatherSection } from '@/components/features/meteo/ParcelWeatherSection';
import { ClimateCard } from '@/components/features/meteo/ClimateCard';
import { MeteoFooter } from '@/components/features/meteo/MeteoFooter';
import { STATUS_STYLES, useMeteoFormat } from '@/components/features/meteo/format';

function MeteoParcelContent({ parcelId }: { parcelId: string }) {
  const { t } = useI18n();
  const f = useMeteoFormat();
  const detail = useMeteoParcel(apiClient, parcelId);
  const status = useMeteoStatus(apiClient);
  const forecastOn = status.data?.forecastEnabled === true;
  // Climatology is its own switch (meteo.climate) — independent of the forecast.
  const climateOn = status.data?.climateEnabled === true && status.data?.climateConfigured === true;
  const readings = useMeteoReadings(apiClient, parcelId);
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return <p className="py-8 text-center text-sm text-red-600">{t('meteo.loadError')}</p>;
  }

  const d = detail.data;
  const label = d.parcelName ?? d.parcelCode ?? parcelId;
  const readingList = readings.data ?? [];

  // 409 HARVEST_EVENT_OPEN: the editor already invalidated the queries; wait for
  // the refetch so `d.event` is the open event, then switch to editing it.
  const openExisting = async () => {
    await detail.refetch();
    setEditor('edit');
  };

  return (
    <div className="space-y-6">
      {forecastOn && <ParcelWeatherSection parcelId={parcelId} />}
      {climateOn && <ClimateCard parcelId={parcelId} />}

      {(forecastOn || climateOn) && (
        <div className="flex items-center gap-3 pt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{t('meteo.wx.dryingDivider')}</h2>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>
      )}

      {/* Status headline */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`mt-1 h-4 w-4 shrink-0 rounded-full ${STATUS_STYLES[d.derived?.status ?? 'grey'].dot}`}
              title={t(`meteo.status.${d.derived?.status ?? 'grey'}`)}
            />
            <div>
              {d.derived ? (
                <MeteoReasons reasons={d.derived.reasons} main />
              ) : (
                <p className="text-base font-medium text-neutral-900">{t('meteo.reason.noEvent')}</p>
              )}
              <p className="mt-2 text-xs text-neutral-500">
                {t('meteo.detail.dataAge')}: {f.hours(d.dataAgeH)} · {t('meteo.detail.computedAt')}:{' '}
                {f.dateTime(d.computedAt)}
                {d.event && ` · ${t('meteo.col.harvestedAt')}: ${f.dateTime(d.event.harvestedAt)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditor(d.event ? 'edit' : 'create')}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            {d.event ? <Pencil className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
            {d.event ? t('meteo.event.editTitle') : t('meteo.event.createTitle')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-neutral-800">{t('meteo.chart.moistureTitle')}</h2>
        <MoistureChart hours={d.hours} thresholdWb={d.thresholdWb} readings={readingList} />
        <p className="mt-2 text-xs text-neutral-400">{t('meteo.chart.legendNote')}</p>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-neutral-800">{t('meteo.chart.rainTitle')}</h2>
        <RainChart hours={d.hours} />
      </section>

      {d.event && <MoistureReadingForm parcelId={parcelId} readings={readingList} />}
      <FingerprintList parcelId={parcelId} />

      {editor && (
        <HarvestEventEditor
          key={editor}
          parcelId={parcelId}
          parcelLabel={label}
          event={editor === 'edit' ? d.event : null}
          onClose={() => setEditor(null)}
          onOpenExisting={() => void openExisting()}
        />
      )}
    </div>
  );
}

/** Back targets reachable via `?from=` — a whitelist, never a raw redirect. */
const BACK_TARGETS: Record<string, string> = { parcels: 'parcels', map: 'map' };

function MeteoParcelHeader({ parcelId }: { parcelId: string }) {
  const { t } = useI18n();
  const slug = useOrgSlug();
  const from = useSearchParams().get('from');
  // Same query key as the content → no extra request; falls back to the generic title.
  const detail = useMeteoParcel(apiClient, parcelId);
  const name = detail.data?.parcelName ?? detail.data?.parcelCode ?? null;
  const backHref = from && BACK_TARGETS[from] ? `/${slug}/${BACK_TARGETS[from]}` : `/${slug}/meteo`;
  return <PageHeader title={name ?? t('meteo.detail.title')} backHref={backHref} />;
}

export default function MeteoParcelPage() {
  const { t } = useI18n();
  const params = useParams<{ parcelId: string }>();
  const slug = useOrgSlug();
  return (
    <LoggingErrorBoundary>
      <Suspense fallback={<PageHeader title={t('meteo.detail.title')} backHref={`/${slug}/meteo`} />}>
        <MeteoParcelHeader parcelId={params.parcelId} />
      </Suspense>
      <MeteoStatusGate>
        <MeteoParcelContent parcelId={params.parcelId} />
      </MeteoStatusGate>
      <MeteoFooter />
    </LoggingErrorBoundary>
  );
}

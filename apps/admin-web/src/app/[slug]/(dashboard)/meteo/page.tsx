'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMeteoFarmWeather, useMeteoOverview, useMeteoStatus } from '@strawboss/api';
import { Map as MapIcon } from 'lucide-react';
import type { MeteoHarvestSuggestion } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { useFeatures } from '@/hooks/useFeatures';
import { MeteoStatusGate } from '@/components/features/meteo/MeteoStatusGate';
import { MeteoKpis } from '@/components/features/meteo/MeteoKpis';
import { MeteoSuggestions } from '@/components/features/meteo/MeteoSuggestions';
import { MeteoParcelTable } from '@/components/features/meteo/MeteoParcelTable';
import { MeteoAlertsFeed } from '@/components/features/meteo/MeteoAlertsFeed';
import { MeteoAlertSettingsPanel } from '@/components/features/meteo/MeteoAlertSettingsPanel';
import { MeteoSettingsPanel } from '@/components/features/meteo/MeteoSettingsPanel';
import { HarvestEventEditor } from '@/components/features/meteo/HarvestEventEditor';
import { MeteoFooter } from '@/components/features/meteo/MeteoFooter';
import { useIsAdmin } from '@/components/features/meteo/useIsAdmin';

// Leaflet touches `window` — client-only.
const FarmWeatherMap = dynamicImport(
  () => import('@/components/features/meteo/FarmWeatherMap').then((m) => m.FarmWeatherMap),
  { ssr: false },
);

function MeteoOverviewContent() {
  const { t } = useI18n();
  const router = useRouter();
  const slug = useOrgSlug();
  const { isAdmin } = useIsAdmin();
  const overview = useMeteoOverview(apiClient);
  const status = useMeteoStatus(apiClient);
  const features = useFeatures();
  const forecastOn = status.data?.forecastEnabled === true;
  // Same query key as the map → one request, shared. Gated: it spends external quota.
  const farm = useMeteoFarmWeather(apiClient, { enabled: forecastOn });
  const [starting, setStarting] = useState<MeteoHarvestSuggestion | null>(null);

  // parcelId → its 0.05° weather cell (cellKey join); "—" in the table when absent.
  const weatherByParcel = useMemo(() => {
    if (!farm.data) return undefined;
    const cells = new Map(farm.data.cells.map((c) => [c.key, c]));
    const byParcel = new Map<string, (typeof farm.data.cells)[number]>();
    for (const p of farm.data.parcels) {
      const c = cells.get(p.cellKey);
      if (c) byParcel.set(p.parcelId, c);
    }
    return byParcel;
  }, [farm.data]);

  if (overview.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return <p className="py-8 text-center text-sm text-red-600">{t('meteo.loadError')}</p>;
  }

  const { rows, suggestions } = overview.data;

  return (
    <>
      {status.data?.alertsEnabled === true && <MeteoAlertsFeed />}
      <MeteoKpis rows={rows} />
      {forecastOn && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-neutral-800">
            <MapIcon className="h-4 w-4 text-sky-600" />
            {t('meteo.wx.farm.title')}
          </h2>
          {/* `relative isolate` keeps Leaflet's pane z-indexes (400–1000) inside this card. */}
          <div className="relative isolate h-[28rem] overflow-hidden rounded-2xl border border-neutral-200 shadow-sm">
            <FarmWeatherMap rows={rows} onSelect={(id) => router.push(`/${slug}/meteo/${id}`)} />
          </div>
        </section>
      )}
      <MeteoSuggestions suggestions={suggestions} onStart={setStarting} />
      <MeteoParcelTable rows={rows} weatherByParcel={weatherByParcel} />
      {isAdmin && (
        <div className="mt-6">
          <MeteoSettingsPanel />
        </div>
      )}
      {isAdmin && forecastOn && features.isEnabled('meteo.alerts') && (
        <div className="mt-6">
          <MeteoAlertSettingsPanel />
        </div>
      )}
      {starting && (
        <HarvestEventEditor
          parcelId={starting.parcelId}
          parcelLabel={starting.parcelName ?? starting.parcelCode ?? starting.parcelId}
          hintAt={starting.hintAt}
          onClose={() => setStarting(null)}
          onOpenExisting={() => router.push(`/${slug}/meteo/${starting.parcelId}`)}
        />
      )}
    </>
  );
}

export default function MeteoPage() {
  const { t } = useI18n();
  return (
    <LoggingErrorBoundary>
      <PageHeader title={t('meteo.title')} />
      <MeteoStatusGate>
        <MeteoOverviewContent />
      </MeteoStatusGate>
      <MeteoFooter />
    </LoggingErrorBoundary>
  );
}

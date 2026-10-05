'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import dynamicImport from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMeteoOverview } from '@strawboss/api';
import type { MeteoHarvestSuggestion } from '@strawboss/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrgSlug } from '@/hooks/useOrgSlug';
import { MeteoStatusGate } from '@/components/features/meteo/MeteoStatusGate';
import { MeteoKpis } from '@/components/features/meteo/MeteoKpis';
import { MeteoSuggestions } from '@/components/features/meteo/MeteoSuggestions';
import { MeteoParcelTable } from '@/components/features/meteo/MeteoParcelTable';
import { MeteoSettingsPanel } from '@/components/features/meteo/MeteoSettingsPanel';
import { HarvestEventEditor } from '@/components/features/meteo/HarvestEventEditor';
import { MeteoFooter } from '@/components/features/meteo/MeteoFooter';
import { useIsAdmin } from '@/components/features/meteo/useIsAdmin';

// Leaflet touches `window` — client-only.
const MeteoMap = dynamicImport(
  () => import('@/components/features/meteo/MeteoMap').then((m) => m.MeteoMap),
  { ssr: false },
);

function MeteoOverviewContent() {
  const { t } = useI18n();
  const router = useRouter();
  const slug = useOrgSlug();
  const { isAdmin } = useIsAdmin();
  const overview = useMeteoOverview(apiClient);
  const [starting, setStarting] = useState<MeteoHarvestSuggestion | null>(null);

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
      <MeteoKpis rows={rows} />
      <MeteoSuggestions suggestions={suggestions} onStart={setStarting} />
      <MeteoParcelTable rows={rows} />
      <div className="mt-6 h-96 overflow-hidden rounded-xl border border-neutral-200">
        <MeteoMap rows={rows} onSelect={(id) => router.push(`/${slug}/meteo/${id}`)} />
      </div>
      {isAdmin && (
        <div className="mt-6">
          <MeteoSettingsPanel />
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

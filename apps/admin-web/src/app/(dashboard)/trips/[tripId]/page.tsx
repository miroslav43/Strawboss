'use client';
export const dynamic = 'force-dynamic';

import { use } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTrip } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { TripDetail } from '@/components/features/trips/TripDetail';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface TripDetailPageProps {
  params: Promise<{ tripId: string }>;
}

export default function TripDetailPage({ params }: TripDetailPageProps) {
  const { t } = useI18n();
  const { tripId } = use(params);
  const tripQuery = useTrip(apiClient, tripId);

  return (
    <div>
      <PageHeader
        title={t('trips.detailTitle')}
        actions={
          <Link
            href="/trips"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('trips.backToTrips')}
          </Link>
        }
      />

      {tripQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('trips.loadingDetail')}
        </div>
      ) : tripQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          {t('trips.loadError')}
        </div>
      ) : tripQuery.data ? (
        <TripDetail trip={tripQuery.data} />
      ) : (
        <div className="py-8 text-center text-sm text-neutral-400">
          {t('trips.notFound')}
        </div>
      )}
    </div>
  );
}

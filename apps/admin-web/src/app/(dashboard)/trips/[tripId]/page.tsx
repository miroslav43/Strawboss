'use client';

import { use } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTrip } from '@strawboss/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { TripDetail } from '@/components/features/trips/TripDetail';
import { apiClient } from '@/lib/api';

interface TripDetailPageProps {
  params: Promise<{ tripId: string }>;
}

export default function TripDetailPage({ params }: TripDetailPageProps) {
  const { tripId } = use(params);
  const tripQuery = useTrip(apiClient, tripId);

  return (
    <div>
      <PageHeader
        title="Trip Detail"
        actions={
          <Link
            href="/trips"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Trips
          </Link>
        }
      />

      {tripQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          Loading trip details...
        </div>
      ) : tripQuery.isError ? (
        <div className="py-8 text-center text-sm text-red-500">
          Failed to load trip. The backend may not be running.
        </div>
      ) : tripQuery.data ? (
        <TripDetail trip={tripQuery.data} />
      ) : (
        <div className="py-8 text-center text-sm text-neutral-400">
          Trip not found.
        </div>
      )}
    </div>
  );
}

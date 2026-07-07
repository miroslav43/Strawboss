'use client';
export const dynamic = 'force-dynamic';

import { useMemo } from 'react';
import dynamicImport from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import { Monitor, MapPin, ExternalLink } from 'lucide-react';
import { useTrips, useParcels, useMachineLocations, useDeliveryDestinations } from '@strawboss/api';
import { TripStatus } from '@strawboss/types';
import type { Trip, Parcel, DeliveryDestination } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { toTripCamelList } from '@/lib/trip-mapper';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';
import { useMachineIconPrefs } from '@/hooks/useMachineIconPrefs';

// ── Dynamic Leaflet map (no SSR) ──────────────────────────────────────────

function MapLoadingPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100">
      <div className="text-center text-sm text-neutral-400">
        <MapPin className="mx-auto mb-2 h-8 w-8 opacity-30" />
        {t('map.loading')}
      </div>
    </div>
  );
}

const LeafletMap = dynamicImport(
  () => import('@/components/map/LeafletMap').then((m) => ({ default: m.LeafletMap })),
  { ssr: false, loading: () => <MapLoadingPlaceholder /> },
);

// ── Active-trip statuses ──────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set<TripStatus>([
  TripStatus.loading,
  TripStatus.loaded,
  TripStatus.in_transit,
  TripStatus.arrived,
  TripStatus.delivering,
  TripStatus.delivered,
]);

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  [TripStatus.loading]: 'bg-blue-100 text-blue-700',
  [TripStatus.loaded]: 'bg-indigo-100 text-indigo-700',
  [TripStatus.in_transit]: 'bg-yellow-100 text-yellow-700',
  [TripStatus.arrived]: 'bg-orange-100 text-orange-700',
  [TripStatus.delivering]: 'bg-purple-100 text-purple-700',
  [TripStatus.delivered]: 'bg-green-100 text-green-700',
};

function TripStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = STATUS_COLORS[status] ?? 'bg-neutral-100 text-neutral-600';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {t(`trips_status.${status}` as Parameters<typeof t>[0])}
    </span>
  );
}

// ── Trip feed row ─────────────────────────────────────────────────────────

function TripFeedRow({ trip, slug }: { trip: Trip; slug: string }) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div
      className="cursor-pointer rounded-lg border border-neutral-100 bg-white p-3 transition-shadow hover:shadow-sm"
      onClick={() => router.push(`/${slug}/trips/${trip.id}`)}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-neutral-700">
          {trip.tripNumber ?? trip.id.slice(0, 8)}
        </span>
        <TripStatusBadge status={trip.status} />
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-neutral-500">
        <span className="truncate">
          <span className="font-medium text-neutral-700">{t('commandCenter.tripSource')}:</span>{' '}
          {trip.sourceParcelCode ?? '—'}
        </span>
        <span className="truncate">
          <span className="font-medium text-neutral-700">{t('commandCenter.tripDest')}:</span>{' '}
          {trip.destinationName ?? '—'}
        </span>
        <span className="truncate">
          <span className="font-medium text-neutral-700">{t('commandCenter.tripBales')}:</span>{' '}
          {trip.baleCount ?? '—'}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/${slug}/trips/${trip.id}`);
          }}
        >
          <ExternalLink className="h-3 w-3" />
          {t('commandCenter.viewTrip')}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CommandCenterPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const parcelsQuery = useParcels(apiClient);
  const locationsQuery = useMachineLocations(apiClient);
  const depositsQuery = useDeliveryDestinations(apiClient);
  const tripsQuery = useTrips(apiClient, { limit: '100', sort: '-createdAt' });

  const parcels = normalizeList<Parcel>(parcelsQuery.data);
  const machines = locationsQuery.data ?? [];
  const deposits = normalizeList<DeliveryDestination>(depositsQuery.data);
  const allTrips: Trip[] = toTripCamelList(normalizeList(tripsQuery.data));

  const activeTrips = useMemo(
    () => allTrips.filter((trip) => ACTIVE_STATUSES.has(trip.status as TripStatus)),
    [allTrips],
  );

  const { prefs: iconPrefs } = useMachineIconPrefs();

  return (
    <LoggingErrorBoundary>
      {/* Full-screen split layout: map left, trip feed right */}
      <div className="flex h-[calc(100vh-7rem)] gap-4" aria-label={t('commandCenter.title')}>
        {/* ── Left: live map ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 shadow-sm">
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2">
            <Monitor className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-neutral-700">{t('commandCenter.liveMap')}</h2>
          </div>
          <div className="relative flex-1">
            <LeafletMap
              parcels={parcels}
              machines={machines}
              deposits={deposits}
              selectedParcelId={null}
              onParcelSelect={() => {}}
              onParcelEdit={() => {}}
              onParcelDelete={() => {}}
              selectionOnly
              iconPrefs={iconPrefs}
            />
          </div>
        </div>

        {/* ── Right: active trip feed ─────────────────────────────────── */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
            <h2 className="text-sm font-semibold text-neutral-700">
              {t('commandCenter.activeTrips')}
            </h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {activeTrips.length}
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {tripsQuery.isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-neutral-200" />
                ))}
              </div>
            )}

            {!tripsQuery.isLoading && activeTrips.length === 0 && (
              <div className="flex h-full items-center justify-center py-12 text-center">
                <p className="text-sm text-neutral-400">{t('commandCenter.noActiveTrips')}</p>
              </div>
            )}

            {activeTrips.map((trip) => (
              <TripFeedRow key={trip.id} trip={trip} slug={slug} />
            ))}
          </div>
        </div>
      </div>
    </LoggingErrorBoundary>
  );
}

'use client';
export const dynamic = 'force-dynamic';

import { useMemo } from 'react';
import dynamicImport from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Wrench,
  Truck,
  Wheat,
  CheckCircle2,
  XCircle,
  MapPin,
  Bell,
  Activity,
} from 'lucide-react';
import { useMachine, useMachineLocations, useTrips, useAlerts } from '@strawboss/api';
import { MachineType, FuelType, AlertSeverity } from '@strawboss/types';
import type { Trip, Alert } from '@strawboss/types';
import { apiClient } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeList } from '@/lib/normalize-api-list';
import { toTripCamelList } from '@/lib/trip-mapper';
import { todayInRomania, addDays } from '@/lib/date';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';
import { FuelConsumptionCard } from './FuelConsumptionCard';
import { BaleProductionCard } from './BaleProductionCard';
import { ConsumableCard } from './ConsumableCard';

// ── Dynamic Leaflet mini-map (no SSR) ─────────────────────────────────────

const MiniMap = dynamicImport(() => import('./MiniMap').then((m) => ({ default: m.MiniMap })), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-400">
      <MapPin className="mr-2 h-4 w-4" />
    </div>
  ),
});

// ── Constants ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.loader]: 'Încărcător',
  [MachineType.baler]: 'Balotieră',
  [MachineType.truck]: 'Camion',
};

const FUEL_LABELS: Record<FuelType, string> = {
  [FuelType.diesel]: 'Diesel',
  [FuelType.gasoline]: 'Benzină',
  [FuelType.electric]: 'Electric',
};

const TYPE_ICON: Record<MachineType, React.ElementType> = {
  [MachineType.truck]: Truck,
  [MachineType.loader]: Wrench,
  [MachineType.baler]: Wheat,
};

const TYPE_COLOR: Record<MachineType, string> = {
  [MachineType.truck]: 'bg-green-100 text-green-700',
  [MachineType.loader]: 'bg-blue-100 text-blue-700',
  [MachineType.baler]: 'bg-amber-100 text-amber-700',
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  [AlertSeverity.low]: 'bg-neutral-100 text-neutral-600',
  [AlertSeverity.medium]: 'bg-amber-100 text-amber-700',
  [AlertSeverity.high]: 'bg-orange-100 text-orange-700',
  [AlertSeverity.critical]: 'bg-red-100 text-red-700',
};

// ── Activity chart ────────────────────────────────────────────────────────

/** Simple 7-day bale-trip bar chart derived from trips data. */
function ActivityChart({ trips }: { trips: Trip[] }) {
  const { t } = useI18n();
  const today = todayInRomania();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));

  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const trip of trips) {
      const day = trip.createdAt?.slice(0, 10);
      if (day) map[day] = (map[day] ?? 0) + 1;
    }
    return map;
  }, [trips]);

  const max = Math.max(...days.map((d) => countByDay[d] ?? 0), 1);

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-neutral-700">
        {t('machineDetail.activityChart')}
      </h3>
      <div className="flex h-24 items-end gap-1.5">
        {days.map((day) => {
          const count = countByDay[day] ?? 0;
          const heightPct = max > 0 ? (count / max) * 100 : 0;
          const label = day.slice(5); // MM-DD
          return (
            <div key={day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-neutral-500">{count > 0 ? count : ''}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(heightPct, 4)}%`,
                  backgroundColor: count > 0 ? 'var(--color-primary, #16a34a)' : '#e5e7eb',
                }}
              />
              <span className="text-[10px] text-neutral-400">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function MachineDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string; machineId: string }>();
  const router = useRouter();
  const machineId = params.machineId;
  const slug = params.slug;

  const machineQuery = useMachine(apiClient, machineId);
  const locationsQuery = useMachineLocations(apiClient);
  const tripsQuery = useTrips(apiClient, {
    truckId: machineId,
    limit: '20',
    sort: '-createdAt',
  });
  const alertsQuery = useAlerts(apiClient, { machineId, limit: '10', sort: '-createdAt' });

  const machine = machineQuery.data;
  const location = locationsQuery.data?.find((l) => l.machineId === machineId);
  const trips: Trip[] = toTripCamelList(normalizeList(tripsQuery.data));
  const alerts: Alert[] = normalizeList<Alert>(alertsQuery.data);

  const TypeIcon = machine ? TYPE_ICON[machine.machineType] : Wrench;
  const typeBadgeCls = machine
    ? TYPE_COLOR[machine.machineType]
    : 'bg-neutral-100 text-neutral-600';

  if (machineQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('machineDetail.loading')} backHref={`/${slug}/machines`} />
        <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    );
  }

  if (machineQuery.isError || !machine) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('machineDetail.notFound')} backHref={`/${slug}/machines`} />
        <p className="text-sm text-red-500">{t('machineDetail.loadError')}</p>
      </div>
    );
  }

  return (
    <LoggingErrorBoundary>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${slug}/machines`)}
            className="rounded-lg border border-neutral-200 bg-white p-2 text-neutral-500 shadow-sm hover:bg-neutral-50 hover:text-neutral-800"
            aria-label={t('machineDetail.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-800">
                {machine.internalCode ?? machine.registrationPlate}
              </h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${typeBadgeCls}`}
              >
                <TypeIcon className="h-3 w-3" />
                {TYPE_LABELS[machine.machineType]}
              </span>
              {machine.isActive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('common.active')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                  <XCircle className="h-3 w-3" />
                  {t('common.inactive')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-neutral-500">
              {machine.make} {machine.model} ({machine.year})
            </p>
          </div>
        </div>

        {/* Row 1: info cards + mini-map */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Machine info */}
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-neutral-700">
              {t('machineDetail.info')}
            </h3>
            <dl className="space-y-2 text-sm">
              <InfoRow label={t('machineDetail.plate')} value={machine.registrationPlate ?? '—'} />
              <InfoRow
                label={t('machineDetail.fuel')}
                value={FUEL_LABELS[machine.fuelType] ?? machine.fuelType}
              />
              <InfoRow
                label={t('machineDetail.tank')}
                value={machine.tankCapacityLiters != null ? `${machine.tankCapacityLiters} L` : '—'}
              />
              <InfoRow
                label={t('machineDetail.hourmeter')}
                value={
                  machine.currentHourmeterHrs != null
                    ? `${machine.currentHourmeterHrs.toLocaleString()} h`
                    : '—'
                }
              />
              {machine.ownerCompanyName && (
                <InfoRow label={t('machineDetail.owner')} value={machine.ownerCompanyName} />
              )}
            </dl>
          </div>

          {/* GPS info */}
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-neutral-700">
              {t('machineDetail.gpsStatus')}
            </h3>
            {location ? (
              <dl className="space-y-2 text-sm">
                <InfoRow
                  label={t('machineDetail.gpsLat')}
                  value={Number(location.lat).toFixed(5)}
                />
                <InfoRow
                  label={t('machineDetail.gpsLon')}
                  value={Number(location.lon).toFixed(5)}
                />
                <InfoRow
                  label={t('machineDetail.gpsTime')}
                  value={new Date(location.recordedAt).toLocaleString()}
                />
                {location.operatorName && (
                  <InfoRow label={t('machineDetail.gpsOperator')} value={location.operatorName} />
                )}
                {location.speedMs != null && (
                  <InfoRow
                    label={t('machineDetail.gpsSpeed')}
                    value={`${(Number(location.speedMs) * 3.6).toFixed(1)} km/h`}
                  />
                )}
              </dl>
            ) : (
              <p className="text-sm text-neutral-400">{t('machineDetail.gpsNoData')}</p>
            )}
          </div>

          {/* Mini-map */}
          <div className="overflow-hidden rounded-xl shadow-sm">
            {location ? (
              <MiniMap
                lat={location.lat}
                lon={location.lon}
                label={machine.internalCode ?? machine.registrationPlate}
              />
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-400">
                <MapPin className="mr-2 h-4 w-4" />
                {t('machineDetail.gpsNoData')}
              </div>
            )}
          </div>
        </div>

        {/* Baler-only: record & review bale production per field */}
        {machine.machineType === MachineType.baler && <BaleProductionCard machineId={machineId} />}

        {/* Row 2: half/half period cards, directly under the bale history */}
        {machine.machineType === MachineType.baler ? (
          /* Baler: consumables (twine / net wrap) + fuel, side by side */
          <div className="grid gap-4 lg:grid-cols-2">
            <ConsumableCard machineId={machineId} />
            <FuelConsumptionCard machineId={machineId} machine={machine} />
          </div>
        ) : (
          /* Truck / loader: trips activity + fuel */
          <div className="grid gap-4 lg:grid-cols-2">
            {tripsQuery.isLoading ? (
              <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
            ) : (
              <ActivityChart trips={trips} />
            )}

            <FuelConsumptionCard machineId={machineId} machine={machine} />
          </div>
        )}

        {/* Row 3: recent trips — trucks/loaders only (a baler runs no trips) */}
        {machine.machineType !== MachineType.baler && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-700">
              <Activity className="h-4 w-4" />
              {t('machineDetail.recentTrips')}
            </h3>
            {tripsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-neutral-100" />
            ) : trips.length === 0 ? (
              <p className="text-sm text-neutral-400">{t('machineDetail.noTrips')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs font-medium uppercase tracking-wider text-neutral-400">
                    <th className="pb-2 pr-4">{t('trips_list.colTripNumber')}</th>
                    <th className="pb-2 pr-4">{t('trips_list.colStatus')}</th>
                    <th className="pb-2 pr-4">{t('trips_list.colSource')}</th>
                    <th className="pb-2 pr-4">{t('trips_list.colDestination')}</th>
                    <th className="pb-2">{t('trips_list.colBales')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {trips.slice(0, 10).map((trip) => (
                    <tr
                      key={trip.id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() => router.push(`/${slug}/trips/${trip.id}`)}
                    >
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-600">
                        {trip.tripNumber ?? trip.id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                          {t(`trips_status.${trip.status as string}` as Parameters<typeof t>[0]) ??
                            trip.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-neutral-600">{trip.sourceParcelCode ?? '—'}</td>
                      <td className="py-2 pr-4 text-neutral-600">{trip.destinationName ?? '—'}</td>
                      <td className="py-2 text-neutral-600">{trip.baleCount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Row 4: alerts */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-700">
            <Bell className="h-4 w-4" />
            {t('machineDetail.alertLog')}
          </h3>
          {alertsQuery.isLoading ? (
            <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
          ) : alerts.length === 0 ? (
            <p className="text-sm text-neutral-400">{t('machineDetail.noAlerts')}</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-start gap-3 rounded-lg border border-neutral-100 p-3"
                >
                  <span
                    className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[alert.severity]}`}
                  >
                    {t(`alerts.severity.${alert.severity}` as Parameters<typeof t>[0])}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-800">{alert.title}</p>
                    <p className="truncate text-xs text-neutral-400">
                      {new Date(alert.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {alert.isAcknowledged && (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LoggingErrorBoundary>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

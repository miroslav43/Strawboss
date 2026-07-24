'use client';

import { ClipboardList, XCircle } from 'lucide-react';
import type { TripRequest } from '@strawboss/types';
import { composeAuxStage } from '@strawboss/domain';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AuxStageBadge } from './AuxStageBadge';

/** i18n key for a beneficiary quality grade ('quality_1' | 'quality_2'). */
function qualityLabelKey(quality: string): string {
  return quality === 'quality_1' ? 'tripRequests.quality1' : 'tripRequests.quality2';
}

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** A label/value cell. Renders nothing when the value is empty. */
function Detail({
  label,
  value,
  full,
}: {
  label: string;
  value: string | number | null | undefined;
  full?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={cn('min-w-0', full && 'sm:col-span-2 lg:col-span-3')}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="whitespace-pre-wrap break-words text-sm font-medium text-neutral-800">
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  show = true,
  children,
}: {
  title: string;
  show?: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

/**
 * Renders the SAME composed stage the Curse Aux table shows.
 *
 * Reading `trip_requests.status` directly here would make the modal disagree with
 * the row that opened it: that column is never written again after confirm(), so
 * it stays frozen at "Confirmată" while the truck is out being loaded and the
 * table correctly says "În încărcare".
 */
function StatusBadge({ request }: { request: TripRequest }) {
  const stage = composeAuxStage({
    status: request.status,
    tripStatus: request.tripStatus,
    tripSignedAt: request.tripSignedAt,
    tripCompletedAt: request.tripCompletedAt,
  });
  return <AuxStageBadge stage={stage} />;
}

export function RequestDetailsModal({
  request: r,
  onClose,
}: {
  request: TripRequest;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const hasCargo = !!(
    r.cropType ||
    r.quality ||
    r.neededDate ||
    r.tonsRequested != null ||
    r.notes
  );
  const hasDestination = !!(r.destinationAddress || r.destinationLocality || r.destinationCoords);
  const hasTransporter = !!(r.transporterName || r.transporterCui || r.transporterAddress);
  const notify = Array.isArray(r.notifyRecipients) ? r.notifyRecipients : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: 'min(90vh, 820px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-neutral-800">
            <ClipboardList className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">
              {t('tripRequests.detailsTitle')}
              {r.requesterName ? ` · ${r.requesterName}` : ''}
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2">
            <StatusBadge request={r} />
          </div>

          <Section title={t('tripRequests.sectionRequester')}>
            <Detail label={t('tripRequests.colRequester')} value={r.requesterName} />
            <Detail label={t('tripRequests.requesterPhone')} value={r.requesterPhone} />
            <Detail label={t('tripRequests.requesterEmail')} value={r.requesterEmail} />
            <Detail label={t('tripRequests.colCompany')} value={r.companyName} />
            <Detail label={t('tripRequests.companyAddress')} value={r.companyAddress} />
            <Detail label={t('tripRequests.companyCui')} value={r.companyCui} />
          </Section>

          <Section title={t('tripRequests.sectionTruck')}>
            <Detail label={t('tripRequests.truckPlate')} value={r.truckRegistrationPlate} />
            <Detail
              label={t('tripRequests.colTruck')}
              value={[r.truckMake, r.truckModel].filter(Boolean).join(' ') || null}
            />
            <Detail
              label={t('tripRequests.truckCapacity')}
              value={
                r.truckCapacityTons != null
                  ? `${r.truckCapacityTons} ${t('tripRequests.tons')}`
                  : null
              }
            />
            <Detail label={t('tripRequests.trailerPlate')} value={r.trailerRegistrationPlate} />
          </Section>

          <Section title={t('tripRequests.sectionDriver')}>
            <Detail label={t('tripRequests.colDriver')} value={r.driverName} />
            <Detail label={t('tripRequests.driverPhone')} value={r.driverPhone} />
            <Detail label={t('tripRequests.driverEmail')} value={r.driverEmail} />
          </Section>

          <Section title={t('tripRequests.sectionCargo')} show={hasCargo}>
            <Detail label={t('tripRequests.colCrop')} value={r.cropType} />
            <Detail
              label={t('tripRequests.quality')}
              value={r.quality ? t(qualityLabelKey(r.quality)) : null}
            />
            <Detail label={t('tripRequests.colNeededDate')} value={r.neededDate} />
            <Detail
              label={t('tripRequests.colTons')}
              value={
                r.tonsRequested != null ? `${r.tonsRequested} ${t('tripRequests.tons')}` : null
              }
            />
            <Detail label={t('tripRequests.notes')} value={r.notes} full />
          </Section>

          <Section title={t('tripRequests.sectionDestination')} show={hasDestination}>
            <Detail label={t('tripRequests.destinationAddress')} value={r.destinationAddress} />
            <Detail label={t('tripRequests.destinationLocality')} value={r.destinationLocality} />
            <Detail
              label={t('tripRequests.destinationCoords')}
              value={
                r.destinationCoords
                  ? `${r.destinationCoords.lat.toFixed(5)}, ${r.destinationCoords.lon.toFixed(5)}`
                  : null
              }
            />
          </Section>

          <Section title={t('tripRequests.sectionTransporter')} show={hasTransporter}>
            <Detail label={t('tripRequests.transporterName')} value={r.transporterName} />
            <Detail label={t('tripRequests.transporterCui')} value={r.transporterCui} />
            <Detail label={t('tripRequests.transporterAddress')} value={r.transporterAddress} />
          </Section>

          <Section title={t('tripRequests.sectionNotify')} show={notify.length > 0}>
            {notify.map((n, i) => (
              <Detail
                key={i}
                label={i === 0 ? `${n.name} ★` : n.name}
                value={[n.phone, n.email].filter(Boolean).join(' · ') || '—'}
              />
            ))}
          </Section>

          <Section title={t('tripRequests.sectionStatus')}>
            <Detail label={t('tripRequests.sourceDepot')} value={r.sourceDepotName} />
            <Detail label={t('tripRequests.sourceField')} value={r.sourceParcelName} />
            <Detail
              label={t('tripRequests.colMachine')}
              value={
                [r.machineMake, r.machineModel].filter(Boolean).join(' ').trim() ||
                r.machinePlate ||
                null
              }
            />
            <Detail label={t('tripRequests.colTrip')} value={r.tripNumber} />
            <Detail label={t('tripRequests.confirmedBy')} value={r.confirmedByName} />
            <Detail label={t('tripRequests.confirmedAt')} value={fmtDateTime(r.confirmedAt)} />
            <Detail label={t('tripRequests.cancelledAt')} value={fmtDateTime(r.cancelledAt)} />
            <Detail
              label={t('tripRequests.cancellationReason')}
              value={r.cancellationReason}
              full
            />
            <Detail label={t('tripRequests.createdAt')} value={fmtDateTime(r.createdAt)} />
          </Section>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-neutral-200 bg-neutral-50 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-white"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

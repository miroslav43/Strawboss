'use client';

import {
  Truck,
  MapPin,
  Weight,
  Package,
  Clock,
  FileText,
  FileSignature,
  Download,
} from 'lucide-react';
import type { Trip, Document as StrawbossDocument } from '@strawboss/types';
import { TripStatus } from '@strawboss/types';
import { useDocuments } from '@strawboss/api';
import { apiClient } from '@/lib/api';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TripTimeline } from '@/components/shared/TripTimeline';
import { SignatureDisplay } from '@/components/shared/SignatureDisplay';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface TripDetailProps {
  trip: Trip;
  className?: string;
}

/** Fallback when a joined name label is missing — show a short id, not a full UUID. */
const shortId = (id: string) => `${id.slice(0, 8)}...`;

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800">{value ?? '--'}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-neutral-500" />
        <h3 className="text-sm font-semibold text-neutral-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// W25: only fetch documents when the trip is in delivered or completed state.
const DOCS_RELEVANT_STATUSES: TripStatus[] = [TripStatus.delivered, TripStatus.completed];

export function TripDetail({ trip, className }: TripDetailProps) {
  const { t } = useI18n();
  const docsEnabled = DOCS_RELEVANT_STATUSES.includes(trip.status);
  const { data: documents } = useDocuments(apiClient, docsEnabled ? trip.id : undefined);
  const cmrDoc = documents?.find(
    (d: StrawbossDocument) => d.documentType === 'cmr' && d.status === 'generated',
  );

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">
            {t('trip_detail.trip')} {trip.tripNumber}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">ID: {trip.id}</p>
        </div>
        <StatusBadge status={trip.status} className="text-sm" />
      </div>

      {/* Timeline */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <TripTimeline currentStatus={trip.status} />
      </div>

      {/* Info sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Transport info */}
        <Section title={t('trip_detail.transport')} icon={Truck}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label={t('trip_detail.truck')}
              value={trip.truckPlate ?? trip.truckCode ?? shortId(trip.truckId)}
            />
            <InfoRow
              label={t('trip_detail.driver')}
              value={trip.driverName ?? shortId(trip.driverId)}
            />
            {trip.loaderId && (
              <InfoRow
                label={t('trip_detail.loader')}
                value={trip.loaderCode ?? trip.loaderPlate ?? shortId(trip.loaderId)}
              />
            )}
            {trip.loaderOperatorId && (
              <InfoRow
                label={t('trip_detail.loaderOperator')}
                value={trip.loaderOperatorName ?? shortId(trip.loaderOperatorId)}
              />
            )}
          </div>
        </Section>

        {/* Route info */}
        <Section title={t('trip_detail.route')} icon={MapPin}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label={t('trip_detail.sourceParcel')}
              value={trip.sourceParcelName ?? trip.sourceParcelCode ?? shortId(trip.sourceParcelId)}
            />
            <InfoRow label={t('trip_detail.destination')} value={trip.destinationName} />
            <InfoRow label={t('trip_detail.destinationAddress')} value={trip.destinationAddress} />
            <InfoRow
              label={t('trip_detail.departureOdometer')}
              value={trip.departureOdometerKm != null ? `${trip.departureOdometerKm} km` : null}
            />
            <InfoRow
              label={t('trip_detail.arrivalOdometer')}
              value={trip.arrivalOdometerKm != null ? `${trip.arrivalOdometerKm} km` : null}
            />
            <InfoRow
              label={t('trip_detail.odometerDistance')}
              value={trip.odometerDistanceKm != null ? `${trip.odometerDistanceKm} km` : null}
            />
            <InfoRow
              label={t('trip_detail.gpsDistance')}
              value={trip.gpsDistanceKm != null ? `${trip.gpsDistanceKm} km` : null}
            />
          </div>
        </Section>

        {/* Load info */}
        <Section title={t('trip_detail.load')} icon={Package}>
          <div className="divide-y divide-neutral-100">
            <InfoRow label={t('trip_detail.bales')} value={trip.baleCount} />
            <InfoRow
              label={t('trip_detail.loadingStarted')}
              value={
                trip.loadingStartedAt ? new Date(trip.loadingStartedAt).toLocaleString() : null
              }
            />
            <InfoRow
              label={t('trip_detail.loadingCompleted')}
              value={
                trip.loadingCompletedAt ? new Date(trip.loadingCompletedAt).toLocaleString() : null
              }
            />
          </div>
        </Section>

        {/* Weight info */}
        <Section title={t('trip_detail.weight')} icon={Weight}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label={t('trip_detail.grossWeight')}
              value={trip.grossWeightKg != null ? `${trip.grossWeightKg} kg` : null}
            />
            <InfoRow
              label={t('trip_detail.tareWeight')}
              value={trip.tareWeightKg != null ? `${trip.tareWeightKg} kg` : null}
            />
            <InfoRow
              label={t('trip_detail.netWeight')}
              value={trip.netWeightKg != null ? `${trip.netWeightKg} kg` : null}
            />
            <InfoRow label={t('trip_detail.weightTicket')} value={trip.weightTicketNumber} />
          </div>
          {trip.weightTicketPhotoUrl && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-neutral-500">
                {t('trip_detail.weightTicket')}
              </p>
              <a
                href={apiClient.resolveAssetUrl(trip.weightTicketPhotoUrl) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={apiClient.resolveAssetUrl(trip.weightTicketPhotoUrl) ?? ''}
                  alt={t('trip_detail.weightTicket')}
                  className="max-h-56 w-auto rounded-lg border border-neutral-200 object-contain transition hover:opacity-90"
                />
              </a>
            </div>
          )}
        </Section>

        {/* Timestamps */}
        <Section title={t('trip_detail.timestamps')} icon={Clock}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label={t('trip_detail.departed')}
              value={trip.departureAt ? new Date(trip.departureAt).toLocaleString() : null}
            />
            <InfoRow
              label={t('trip_detail.arrived')}
              value={trip.arrivalAt ? new Date(trip.arrivalAt).toLocaleString() : null}
            />
            <InfoRow
              label={t('trip_detail.delivered')}
              value={trip.deliveredAt ? new Date(trip.deliveredAt).toLocaleString() : null}
            />
            <InfoRow
              label={t('trip_detail.completed')}
              value={trip.completedAt ? new Date(trip.completedAt).toLocaleString() : null}
            />
            <InfoRow
              label={t('trip_detail.created')}
              value={new Date(trip.createdAt).toLocaleString()}
            />
          </div>
        </Section>

        {/* Delivery info */}
        <Section title={t('trip_detail.delivery')} icon={FileText}>
          <div className="divide-y divide-neutral-100">
            <InfoRow label={t('trip_detail.receiver')} value={trip.receiverName} />
            <InfoRow label={t('trip_detail.notes')} value={trip.deliveryNotes} />
          </div>
        </Section>

        {/* Signatures */}
        {(trip.loaderSignatureUrl || trip.driverSignatureUrl || trip.receiverSignatureUrl) && (
          <Section title={t('trips_detail.signatures')} icon={FileSignature}>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-500">
                  {t('trips_detail.loaderOperator')}
                </p>
                <SignatureDisplay
                  signatureUrl={trip.loaderSignatureUrl}
                  signerName={trip.loaderOperatorName}
                  signedAt={trip.loadingCompletedAt}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-500">
                  {t('trips_detail.driver')}
                </p>
                <SignatureDisplay
                  signatureUrl={trip.driverSignatureUrl}
                  signerName={trip.driverName}
                  signedAt={trip.departureAt}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-500">
                  {t('trips_detail.deposit')}
                </p>
                <SignatureDisplay
                  signatureUrl={trip.receiverSignatureUrl}
                  signerName={trip.receiverName}
                  signedAt={trip.receiverSignedAt}
                />
              </div>
            </div>
          </Section>
        )}

        {/* Documents / CMR */}
        {docsEnabled && (
          <Section title={t('trips_detail.documents')} icon={Download}>
            <div className="divide-y divide-neutral-100">
              {cmrDoc ? (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-neutral-700">
                    {t('trips_detail.cmrTitle', { tripNumber: trip.tripNumber })}
                  </span>
                  <a
                    href={cmrDoc.fileUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('trips_detail.cmrDownload')}
                  </a>
                </div>
              ) : (
                <p className="py-2 text-sm text-neutral-500">{t('trips_detail.cmrGenerating')}</p>
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

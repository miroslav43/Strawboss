'use client';

import {
  Truck,
  MapPin,
  Weight,
  Package,
  Clock,
  FileText,
} from 'lucide-react';
import type { Trip } from '@strawboss/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TripTimeline } from '@/components/shared/TripTimeline';
import { SignatureDisplay } from '@/components/shared/SignatureDisplay';
import { cn } from '@/lib/utils';

interface TripDetailProps {
  trip: Trip;
  className?: string;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
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

export function TripDetail({ trip, className }: TripDetailProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">
            Trip {trip.tripNumber}
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
        <Section title="Transport" icon={Truck}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label="Truck"
              value={trip.truckId.slice(0, 8) + '...'}
            />
            <InfoRow
              label="Driver"
              value={trip.driverId.slice(0, 8) + '...'}
            />
            {trip.loaderId && (
              <InfoRow
                label="Loader"
                value={trip.loaderId.slice(0, 8) + '...'}
              />
            )}
            {trip.loaderOperatorId && (
              <InfoRow
                label="Loader Operator"
                value={trip.loaderOperatorId.slice(0, 8) + '...'}
              />
            )}
          </div>
        </Section>

        {/* Route info */}
        <Section title="Route" icon={MapPin}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label="Source Parcel"
              value={trip.sourceParcelId.slice(0, 8) + '...'}
            />
            <InfoRow
              label="Destination"
              value={trip.destinationName}
            />
            <InfoRow
              label="Destination Address"
              value={trip.destinationAddress}
            />
            <InfoRow
              label="Departure Odometer"
              value={
                trip.departureOdometerKm != null
                  ? `${trip.departureOdometerKm} km`
                  : null
              }
            />
            <InfoRow
              label="Arrival Odometer"
              value={
                trip.arrivalOdometerKm != null
                  ? `${trip.arrivalOdometerKm} km`
                  : null
              }
            />
            <InfoRow
              label="Odometer Distance"
              value={
                trip.odometerDistanceKm != null
                  ? `${trip.odometerDistanceKm} km`
                  : null
              }
            />
            <InfoRow
              label="GPS Distance"
              value={
                trip.gpsDistanceKm != null
                  ? `${trip.gpsDistanceKm} km`
                  : null
              }
            />
          </div>
        </Section>

        {/* Load info */}
        <Section title="Load" icon={Package}>
          <div className="divide-y divide-neutral-100">
            <InfoRow label="Bales" value={trip.baleCount} />
            <InfoRow
              label="Loading Started"
              value={
                trip.loadingStartedAt
                  ? new Date(trip.loadingStartedAt).toLocaleString()
                  : null
              }
            />
            <InfoRow
              label="Loading Completed"
              value={
                trip.loadingCompletedAt
                  ? new Date(trip.loadingCompletedAt).toLocaleString()
                  : null
              }
            />
          </div>
        </Section>

        {/* Weight info */}
        <Section title="Weight" icon={Weight}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label="Gross Weight"
              value={
                trip.grossWeightKg != null
                  ? `${trip.grossWeightKg} kg`
                  : null
              }
            />
            <InfoRow
              label="Tare Weight"
              value={
                trip.tareWeightKg != null
                  ? `${trip.tareWeightKg} kg`
                  : null
              }
            />
            <InfoRow
              label="Net Weight"
              value={
                trip.netWeightKg != null
                  ? `${trip.netWeightKg} kg`
                  : null
              }
            />
            <InfoRow
              label="Weight Ticket #"
              value={trip.weightTicketNumber}
            />
          </div>
        </Section>

        {/* Timestamps */}
        <Section title="Timestamps" icon={Clock}>
          <div className="divide-y divide-neutral-100">
            <InfoRow
              label="Departed"
              value={
                trip.departureAt
                  ? new Date(trip.departureAt).toLocaleString()
                  : null
              }
            />
            <InfoRow
              label="Arrived"
              value={
                trip.arrivalAt
                  ? new Date(trip.arrivalAt).toLocaleString()
                  : null
              }
            />
            <InfoRow
              label="Delivered"
              value={
                trip.deliveredAt
                  ? new Date(trip.deliveredAt).toLocaleString()
                  : null
              }
            />
            <InfoRow
              label="Completed"
              value={
                trip.completedAt
                  ? new Date(trip.completedAt).toLocaleString()
                  : null
              }
            />
            <InfoRow
              label="Created"
              value={new Date(trip.createdAt).toLocaleString()}
            />
          </div>
        </Section>

        {/* Delivery info */}
        <Section title="Delivery" icon={FileText}>
          <div className="divide-y divide-neutral-100">
            <InfoRow label="Receiver" value={trip.receiverName} />
            <InfoRow label="Notes" value={trip.deliveryNotes} />
          </div>
          {trip.receiverSignatureUrl && (
            <div className="mt-3">
              <SignatureDisplay
                signatureUrl={trip.receiverSignatureUrl}
                signerName={trip.receiverName}
                signedAt={trip.receiverSignedAt}
              />
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

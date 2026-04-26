import type { Trip } from '@strawboss/types';

/**
 * Map a raw snake_case trip row (as returned by `GET /api/v1/trips/:id`)
 * into the canonical `Trip` camelCase shape consumed by UI components.
 *
 * The backend returns SQL results as-is; this helper bridges that gap
 * without requiring a response interceptor on the server side.
 */
export function toTripCamel(raw: unknown): Trip | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    id: String(r.id),
    tripNumber: (r.trip_number as string) ?? '',
    status: r.status as Trip['status'],
    sourceParcelId: (r.source_parcel_id as string) ?? '',
    sourceParcelAuto: Boolean(r.source_parcel_auto),
    loaderId: (r.loader_id as string | null) ?? null,
    truckId: (r.truck_id as string) ?? '',
    loaderOperatorId: (r.loader_operator_id as string | null) ?? null,
    driverId: (r.driver_id as string) ?? '',
    baleCount: Number(r.bale_count ?? 0),
    loadingStartedAt: (r.loading_started_at as string | null) ?? null,
    loadingCompletedAt: (r.loading_completed_at as string | null) ?? null,
    departureOdometerKm: num(r.departure_odometer_km),
    departureAt: (r.departure_at as string | null) ?? null,
    arrivalOdometerKm: num(r.arrival_odometer_km),
    arrivalAt: (r.arrival_at as string | null) ?? null,
    gpsDistanceKm: num(r.gps_distance_km),
    destinationName: (r.destination_name as string | null) ?? null,
    destinationAddress: (r.destination_address as string | null) ?? null,
    destinationCoords: (r.destination_coords as Trip['destinationCoords']) ?? null,
    grossWeightKg: num(r.gross_weight_kg),
    tareWeightKg: num(r.tare_weight_kg),
    netWeightKg: num(r.net_weight_kg),
    weightTicketNumber: (r.weight_ticket_number as string | null) ?? null,
    weightTicketPhotoUrl: (r.weight_ticket_photo_url as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    deliveryNotes: (r.delivery_notes as string | null) ?? null,
    receiverName: (r.receiver_name as string | null) ?? null,
    receiverSignatureUrl: (r.receiver_signature_url as string | null) ?? null,
    receiverSignedAt: (r.receiver_signed_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    cancelledAt: (r.cancelled_at as string | null) ?? null,
    cancellationReason: (r.cancellation_reason as string | null) ?? null,
    odometerDistanceKm: num(r.odometer_distance_km),
    distanceDiscrepancyKm: num(r.distance_discrepancy_km),
    fraudFlags: (r.fraud_flags as Record<string, unknown> | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    syncVersion: Number(r.sync_version ?? 0),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    deletedAt: (r.deleted_at as string | null) ?? null,
  };
}

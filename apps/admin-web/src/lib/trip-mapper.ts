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
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  return {
    id: String(r.id),
    tripNumber: (r.trip_number as string) ?? '',
    status: r.status as Trip['status'],
    sourceParcelId: (r.source_parcel_id as string | null) ?? null,
    sourceDepotId: (r.source_depot_id as string | null) ?? null,
    sourceParcelAuto: Boolean(r.source_parcel_auto),
    loaderId: (r.loader_id as string | null) ?? null,
    truckId: (r.truck_id as string) ?? '',
    loaderOperatorId: (r.loader_operator_id as string | null) ?? null,
    driverId: (r.driver_id as string | null) ?? null,
    baleCount: Number(r.bale_count ?? 0),
    parentTripId: (r.parent_trip_id as string | null) ?? null,
    iterationIndex: Number(r.iteration_index ?? 1),
    recallDecision: (r.recall_decision as Trip['recallDecision']) ?? null,
    recallDecidedAt: (r.recall_decided_at as string | null) ?? null,
    loadingStartedAt: (r.loading_started_at as string | null) ?? null,
    loadingCompletedAt: (r.loading_completed_at as string | null) ?? null,
    departureAt: (r.departure_at as string | null) ?? null,
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
    deterioratedBalesCount: num(r.deteriorated_bales_count),
    deliveredBaleCount: num(r.delivered_bale_count),
    loaderSignatureUrl: (r.loader_signature_url as string | null) ?? null,
    driverSignatureUrl: (r.driver_signature_url as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    deliveryNotes: (r.delivery_notes as string | null) ?? null,
    receiverName: (r.receiver_name as string | null) ?? null,
    receiverSignatureUrl: (r.receiver_signature_url as string | null) ?? null,
    receiverSignedAt: (r.receiver_signed_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    cancelledAt: (r.cancelled_at as string | null) ?? null,
    cancellationReason: (r.cancellation_reason as string | null) ?? null,
    isAuxiliary: Boolean(r.is_auxiliary),
    externalDriverName: (r.external_driver_name as string | null) ?? null,
    externalDriverPhone: (r.external_driver_phone as string | null) ?? null,
    externalDriverEmail: (r.external_driver_email as string | null) ?? null,
    publicSignToken: (r.public_sign_token as string | null) ?? null,
    publicSignTokenUsedAt: (r.public_sign_token_used_at as string | null) ?? null,
    tripRequestId: (r.trip_request_id as string | null) ?? null,
    fraudFlags: (r.fraud_flags as Record<string, unknown> | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    syncVersion: Number(r.sync_version ?? 0),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    deletedAt: (r.deleted_at as string | null) ?? null,
    // Enriched join labels from GET /trips/:id.
    truckPlate: (r.truck_plate as string | null) ?? null,
    truckCode: (r.truck_code as string | null) ?? null,
    driverName: (r.driver_name as string | null) ?? null,
    loaderPlate: (r.loader_plate as string | null) ?? null,
    loaderCode: (r.loader_code as string | null) ?? null,
    loaderOperatorName: (r.loader_operator_name as string | null) ?? null,
    sourceParcelName: (r.source_parcel_name as string | null) ?? null,
    sourceParcelCode: (r.source_parcel_code as string | null) ?? null,
    sourceParcelMunicipality: (r.source_parcel_municipality as string | null) ?? null,
    sourceFarmName: (r.source_farm_name as string | null) ?? null,
    // Depot-operator delivery confirmation fields.
    depotOperatorId: (r.depot_operator_id as string | null) ?? null,
    depotConfirmedAt: (r.depot_confirmed_at as string | null) ?? null,
    depotOperatorSignatureUrl: (r.depot_operator_signature_url as string | null) ?? null,
    scaleBroken: Boolean(r.scale_broken),
    destinationHasOperator:
      r.destination_has_operator != null ? Boolean(r.destination_has_operator) : undefined,
  };
}

/**
 * Map a list of raw snake_case trip rows (as returned by `GET /api/v1/trips`)
 * into the canonical `Trip` camelCase shape. Use with `normalizeList()` to
 * unwrap either a bare array or a `{ data: [...] }` envelope first:
 *   `toTripCamelList(normalizeList(tripsQuery.data))`
 */
export function toTripCamelList(rows: unknown[]): Trip[] {
  return rows.map((r) => toTripCamel(r)).filter((t): t is Trip => t !== null);
}

import type { Timestamps, SoftDelete, GeoPoint } from '../common.js';

export enum TripStatus {
  planned = 'planned',
  loading = 'loading',
  loaded = 'loaded',
  in_transit = 'in_transit',
  arrived = 'arrived',
  delivering = 'delivering',
  delivered = 'delivered',
  completed = 'completed',
  cancelled = 'cancelled',
  disputed = 'disputed',
}

/**
 * Auxiliary (external, one-time) trucks have a collapsed 3-status lifecycle:
 * `planned → loaded → completed`. There is no depart/arrive/deliver — the loader
 * finishing the load lands the trip on `loaded`, and it auto-completes a few
 * minutes later. Single source of truth for the admin trip-detail timeline and
 * status-override dropdown when `trip.isAuxiliary` is true.
 */
export const AUXILIARY_TRIP_STATUSES = [
  TripStatus.planned,
  TripStatus.loaded,
  TripStatus.completed,
] as const;

export interface Trip extends Timestamps, SoftDelete {
  id: string;
  tripNumber: string;
  status: TripStatus;
  sourceParcelId: string | null;
  /** Depot source — set when the load is sourced from a depot instead of a parcel. Exactly one of sourceParcelId / sourceDepotId is set. */
  sourceDepotId: string | null;
  sourceParcelAuto: boolean;
  loaderId: string | null;
  truckId: string;
  loaderOperatorId: string | null;
  /**
   * NULL for an auxiliary trip — the external truck's driver has no app account
   * (see externalDriver* below). Non-null for every normal trip.
   */
  driverId: string | null;
  baleCount: number;
  /** Plan C — NULL for the root iteration, non-null for iteration N>=2. */
  parentTripId: string | null;
  /** Plan C — 1-based position inside the course. Always 1 for legacy rows. */
  iterationIndex: number;
  /**
   * Plan C — loader's answer to the recall prompt: null = not yet answered,
   * 'recalled' = truck called back (next iteration minted), 'declined' = truck
   * released (admin alerted). Server-managed; replaces delivery_notes markers.
   */
  recallDecision: 'recalled' | 'declined' | null;
  /** Plan C — when the recall decision was recorded; idempotency guard. */
  recallDecidedAt: string | null;
  loadingStartedAt: string | null;
  loadingCompletedAt: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  gpsDistanceKm: number | null;
  destinationName: string | null;
  destinationAddress: string | null;
  destinationCoords: GeoPoint | null;
  grossWeightKg: number | null;
  tareWeightKg: number | null;
  netWeightKg: number | null;
  weightTicketNumber: string | null;
  weightTicketPhotoUrl: string | null;
  deterioratedBalesCount: number | null;
  loaderSignatureUrl: string | null;
  driverSignatureUrl: string | null;
  deliveredAt: string | null;
  deliveryNotes: string | null;
  receiverName: string | null;
  receiverSignatureUrl: string | null;
  receiverSignedAt: string | null;
  completedAt: string | null;
  // Depot-operator delivery confirmation (driver → operator depozit). Set when a
  // depot_manager confirms the arriving truck at the destination depot. The
  // operator's signature is also written to receiverSignatureUrl (they are the
  // receiver), and scaleBroken/NULL weights flag a count-only confirmation.
  depotOperatorId: string | null;
  depotConfirmedAt: string | null;
  depotOperatorSignatureUrl: string | null;
  scaleBroken: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;

  // ── Auxiliary (one-time external) truck support ───────────────────────────
  /**
   * True for a trip spun up from a confirmed external trip_request. Drives the
   * collapsed lifecycle: loader finishes loading ⇒ status=completed (no
   * arrive/depot/receiver step), and the driver signs via publicSignToken.
   */
  isAuxiliary: boolean;
  /** External driver contact, captured from the request (no users row). */
  externalDriverName: string | null;
  externalDriverPhone: string | null;
  externalDriverEmail: string | null;
  /** One-time token for the public driver sign-and-leave link (/<slug>/sign/<token>). */
  publicSignToken: string | null;
  publicSignTokenUsedAt: string | null;
  /** The trip_request this auxiliary trip was created from. */
  tripRequestId: string | null;

  fraudFlags: Record<string, unknown> | null;
  clientId: string | null;
  syncVersion: number;

  /**
   * Read-model flag: true when the destination depot has a depot_manager
   * assigned. Drives the driver app to a read-only delivery view (the operator
   * confirms) vs. the legacy driver-confirms flow. Populated by GET /trips/:id
   * and the sync pull; optional elsewhere.
   */
  destinationHasOperator?: boolean;

  // Enriched join labels — populated only by GET /trips/:id, optional elsewhere.
  truckPlate?: string | null;
  truckCode?: string | null;
  driverName?: string | null;
  loaderPlate?: string | null;
  loaderCode?: string | null;
  loaderOperatorName?: string | null;
  sourceParcelName?: string | null;
  sourceParcelCode?: string | null;
  /** Locality (municipality) of the source parcel — enriched join label. */
  sourceParcelMunicipality?: string | null;
  /** Name of the farm the source parcel belongs to — enriched join label. */
  sourceFarmName?: string | null;
}

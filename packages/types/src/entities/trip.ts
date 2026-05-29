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

export interface Trip extends Timestamps, SoftDelete {
  id: string;
  tripNumber: string;
  status: TripStatus;
  sourceParcelId: string;
  sourceParcelAuto: boolean;
  loaderId: string | null;
  truckId: string;
  loaderOperatorId: string | null;
  driverId: string;
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
  departureOdometerKm: number | null;
  departureAt: string | null;
  arrivalOdometerKm: number | null;
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
  cancelledAt: string | null;
  cancellationReason: string | null;
  odometerDistanceKm: number | null;
  distanceDiscrepancyKm: number | null;
  fraudFlags: Record<string, unknown> | null;
  clientId: string | null;
  syncVersion: number;

  // Enriched join labels — populated only by GET /trips/:id, optional elsewhere.
  truckPlate?: string | null;
  truckCode?: string | null;
  driverName?: string | null;
  loaderPlate?: string | null;
  loaderCode?: string | null;
  loaderOperatorName?: string | null;
  sourceParcelName?: string | null;
  sourceParcelCode?: string | null;
}

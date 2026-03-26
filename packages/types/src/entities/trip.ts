import type { Timestamps, SoftDelete, GeoPoint } from "../common.js";

export enum TripStatus {
  planned = "planned",
  loading = "loading",
  loaded = "loaded",
  in_transit = "in_transit",
  arrived = "arrived",
  delivering = "delivering",
  delivered = "delivered",
  completed = "completed",
  cancelled = "cancelled",
  disputed = "disputed",
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
}

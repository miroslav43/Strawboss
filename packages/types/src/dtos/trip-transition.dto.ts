export interface StartLoadingDto {
  loaderId?: string;
  loaderOperatorId: string;
}

export interface CompleteLoadingDto {}

export interface DepartDto {
  driverSignature: string;
}

// Trip distance is derived entirely from the GPS track (depart → arrive),
// so the arrive payload carries no fields.
export interface ArriveDto {}

export interface StartDeliveryDto {
  destinationName?: string;
}

export interface ConfirmDeliveryDto {
  grossWeightKg: number;
  weightTicketNumber?: string;
  weightTicketPhotoUrl?: string;
  deterioratedBalesCount?: number | null;
}

export interface CompleteDto {
  receiverName: string;
  receiverSignature: string;
}

export interface CancelDto {
  cancellationReason: string;
}

export interface DisputeDto {
  reason: string;
}

export interface ResolveDisputeDto {
  resolutionNotes: string;
  resolvedTo: 'delivered' | 'completed';
}

/**
 * Atomic loader payload: find/create the trip for (truck, today), insert a
 * `bale_loads` row, and transition the trip directly to `loaded`.
 *
 * `idempotencyKey` is the client-side bale_load UUID — the server uses it to
 * dedupe retries via `sync_idempotency`.
 */
export interface RegisterLoadDto {
  truckId: string;
  loaderMachineId: string;
  parcelId: string;
  baleCount: number;
  gpsLat?: number;
  gpsLon?: number;
  idempotencyKey: string;
  loaderSignature?: string;
}

export interface RegisterLoadResult {
  trip: Record<string, unknown>;
  baleLoadId: string;
  created: boolean;
}

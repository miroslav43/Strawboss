import type { TripStatus } from '../entities/trip.js';

export interface StartLoadingDto {
  loaderId?: string;
  loaderOperatorId: string;
}

/** Admin-only manual status override (bypasses the state machine). */
export interface ForceStatusDto {
  status: TripStatus;
  reason?: string;
  /**
   * Optional optimistic-lock guard: when supplied, the update only applies if
   * the trip's current status still matches. Lets an admin UI that read a
   * status confirm it hasn't changed concurrently before overriding it.
   */
  expectedStatus?: TripStatus;

  // ── The load ───────────────────────────────────────────────────────────────
  // Forcing a trip to `loaded` (or beyond) used to move ONLY the status: no
  // cargo, no source, no `bale_loads` row. The result was a phantom trip that
  // looked loaded, carried 0 bales and moved no stock — and 4 of them exist in
  // production. So when the target status implies the goods have been picked up
  // and the trip carries no load yet, these become REQUIRED (the server rejects
  // with `load_required`); when the loader already registered a real load, they
  // are ignored.
  //
  // Exactly one source. Inserting the `bale_loads` row IS the stock deduction —
  // parcel remaining is derived as SUM(bale_productions) − SUM(bale_loads).
  baleCount?: number;
  /** XOR with `sourceDepotId`. */
  parcelId?: string;
  /** XOR with `parcelId`. */
  sourceDepotId?: string;
  /** Client-side bale_load UUID, so a retried override doesn't double-count. */
  idempotencyKey?: string;
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
  grossWeightKg?: number | null;
  tareWeightKg?: number | null;
  weightTicketNumber?: string;
  weightTicketPhotoUrl?: string;
  deterioratedBalesCount?: number | null;
  scaleBroken?: boolean;
}

export interface CompleteDto {
  receiverName: string;
  receiverSignature: string;
}

/**
 * Depot-operator delivery confirmation. A depot_manager assigned to the trip's
 * destination depot confirms the arriving bale count and signs; the single action
 * drives the trip arrived→delivered→completed server-side.
 *
 * - `baleCount` is always required (the count the truck actually arrived with).
 * - `grossWeightKg`/`tareWeightKg` are entered only on a `principal` depot with a
 *   working scale; on a `temporary` depot or when `scaleBroken` they are omitted.
 * - `depotOperatorSignature` is stored as both the depot-operator and receiver
 *   signature.
 * - `idempotencyKey` (the client mutation UUID) dedupes retries via
 *   `sync_idempotency`.
 */
export interface ConfirmDepotDeliveryDto {
  baleCount: number;
  grossWeightKg?: number | null;
  tareWeightKg?: number | null;
  scaleBroken?: boolean;
  depotOperatorSignature: string;
  idempotencyKey: string;
}

/**
 * One inbound truck heading to a depot, as shown to the depot operator: distance
 * to the depot and whether it is inside the confirm-geofence (ready to confirm).
 */
export interface DepotIncomingTruck {
  tripId: string;
  tripNumber: string;
  status: TripStatus;
  truckId: string;
  truckPlate: string | null;
  truckCode: string | null;
  driverName: string | null;
  baleCount: number;
  /** Metres from the truck's latest GPS fix to the depot; null if no recent fix. */
  distanceM: number | null;
  /** True when distanceM is within the depot's confirmRadiusM. */
  isInsideGeofence: boolean;
  /** True when the truck has arrived and is awaiting depot confirmation. */
  awaitingConfirmation: boolean;
  lastSeenAt: string | null;
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
  /**
   * Exactly one of `parcelId` / `sourceDepotId` — the goods come off a field or
   * out of a depot. This type used to require `parcelId` and omit `sourceDepotId`
   * entirely, three migrations after 00073 added depot sourcing, so the service
   * had to widen it back with a local type. It now matches `registerLoadSchema`,
   * which enforces the XOR.
   */
  parcelId?: string;
  sourceDepotId?: string;
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

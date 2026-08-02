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
 * finishing the load lands the trip on `loaded`, and it completes once the
 * external driver uploads the arrival CMR via the one-time public link (or an
 * admin force-completes it with a reason). Single source of truth for the admin
 * trip-detail timeline and status-override dropdown when `trip.isAuxiliary` is true.
 */
export const AUXILIARY_TRIP_STATUSES = [
  TripStatus.planned,
  TripStatus.loaded,
  TripStatus.completed,
] as const;

/**
 * The single, honest status of an auxiliary transport.
 *
 * An aux transport lives on TWO axes that neither alone can describe:
 *   - `trip_requests.status` (pending | confirmed | cancelled) — the commercial
 *     axis. It is NEVER written again after confirm(), so it goes stale the
 *     moment the trip starts moving.
 *   - `trips.status` (TripStatus) — the execution axis. It does not exist at all
 *     until a dispatcher materializes the trip on the truck board, which can be
 *     days after the request was confirmed.
 *
 * Composing them (see `composeAuxStage` in @strawboss/domain) is what makes the
 * ladder TOTAL — every request renders, including the ones with no trip yet —
 * and HONEST: it never shows a TripStatus that an aux trip cannot reach.
 *
 * `unplanned` is the one stage that exists in reality but was invisible in the
 * product: confirmed, an aux truck minted, and nobody has scheduled it yet. It
 * has no timeout and no alert, so it needs to be visible.
 *
 * Ordinals are the display sort order — do not reorder casually.
 */
export enum AuxStage {
  cancelled = 'cancelled',
  /** Submitted through the portal; awaiting confirm/cancel. No trip, no truck. */
  pending = 'pending',
  /** Confirmed and an aux truck minted, but no dispatcher has scheduled it yet. */
  unplanned = 'unplanned',
  planned = 'planned',
  loading = 'loading',
  /**
   * Loaded; the departure CMR is in, but the external driver has not yet
   * uploaded the arrival CMR through the one-time public link. There is no
   * further split beyond this — the upload completes the trip atomically, so
   * there is no observable "uploaded but not yet completed" moment to render.
   */
  awaitingArrivalCmr = 'awaitingArrivalCmr',
  completed = 'completed',
}

/** Display/sort order of the aux ladder. Index = `stageOrder` on an aux row. */
export const AUX_STAGE_ORDER: readonly AuxStage[] = [
  AuxStage.pending,
  AuxStage.unplanned,
  AuxStage.planned,
  AuxStage.loading,
  AuxStage.awaitingArrivalCmr,
  AuxStage.completed,
  AuxStage.cancelled,
] as const;

/** Stages that are still live work — the aux table's default view. */
export const ACTIVE_AUX_STAGES: readonly AuxStage[] = [
  AuxStage.pending,
  AuxStage.unplanned,
  AuxStage.planned,
  AuxStage.loading,
  AuxStage.awaitingArrivalCmr,
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
  /**
   * Bales actually delivered, distinct from the loaded `baleCount`. Set on the
   * driver (non-depot) confirm-delivery path as `baleCount - deterioratedBalesCount`;
   * NULL for depot-confirmed trips (which overwrite `baleCount` itself instead —
   * see confirmDepotDelivery) and for trips predating this column. Reconciliation
   * falls back to `baleCount` when NULL.
   */
  deliveredBaleCount: number | null;
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
  /**
   * Step 1 of the two-step depot flow: when the operator pressed "Începe
   * descărcarea". This is what turns the driver's mute hourglass into "se
   * descarcă acum", so it must stay in the sync pull's trip columns.
   */
  depotUnloadStartedAt: string | null;
  /**
   * The operator confirmed with the truck's GPS stale or outside the depot's
   * confirmRadiusM, using the explicit override. Mirrors
   * `BaleLoad.locationUnverified`; raises a fraud alert for admin review.
   */
  depotConfirmLocationUnverified: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;

  // ── Auxiliary (one-time external) truck support ───────────────────────────
  /**
   * True for a trip spun up from a confirmed external trip_request. Drives the
   * collapsed lifecycle: loader finishes loading ⇒ status=loaded, and the trip
   * only reaches completed once the driver uploads the arrival CMR via
   * publicSignToken (or an admin force-completes it with a reason).
   */
  isAuxiliary: boolean;
  /** External driver contact, captured from the request (no users row). */
  externalDriverName: string | null;
  externalDriverPhone: string | null;
  externalDriverEmail: string | null;
  /**
   * `publicSignToken` is DELIBERATELY ABSENT from this type.
   *
   * It is the one-time BEARER SECRET behind /<slug>/cmr/<token> — whoever holds
   * it can upload the arrival CMR as the external driver. (The column and route
   * keep their historical "sign" name from when this was an electronic
   * signature; the secret and its one-time-use guarantee are unchanged.) It
   * used to reach every authenticated client, because GET /trips did `SELECT
   * t.*` and carries no @Roles, so any driver or loader could read every trip's
   * token. The read endpoints now use an explicit projection that omits it, and
   * it is off the type so nothing can casually put it back. The token is
   * minted server-side and the link is SMS'd straight to the driver; no client
   * ever needs to see it.
   *
   * Only the "has it been used" timestamp is safe to expose.
   */
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
  /**
   * Who that operator is, so the waiting driver can see a name and phone him
   * instead of staring at an anonymous hourglass. Populated alongside
   * destinationHasOperator; null when the depot has no assigned manager.
   */
  destinationOperatorName?: string | null;
  destinationOperatorPhone?: string | null;

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
  /**
   * Name of the depot the trip was loaded from — enriched join label.
   * A trip may carry a source depot instead of (or alongside) a source parcel;
   * migration 00073's CHECK is a disjunction, not an exclusive-or.
   */
  sourceDepotName?: string | null;
}

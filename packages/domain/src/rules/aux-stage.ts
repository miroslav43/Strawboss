import { AuxStage, AUX_STAGE_ORDER, RequestStatus, TripStatus } from '@strawboss/types';

/**
 * The subset of an auxiliary request + its live trip that determines the stage.
 * Deliberately structural rather than `TripRequest`, so this stays callable from
 * a report, an export or an alert that only has these five fields.
 */
export interface AuxStageInput {
  /** The commercial axis: trip_requests.status. */
  status: RequestStatus | string;
  /** The execution axis: trips.status of the live trip, absent until one exists. */
  tripStatus?: TripStatus | string | null;
  /** trips.public_sign_token_used_at — when the external driver signed. */
  tripSignedAt?: string | null;
  /** trips.completed_at. */
  tripCompletedAt?: string | null;
}

/**
 * Collapse the two axes of an auxiliary transport into one honest stage.
 *
 * The rules, in order:
 *
 * 1. Cancelled wins from either axis. A request can be cancelled before it is
 *    confirmed; a trip can be cancelled after.
 *
 * 2. `pending` means exactly what the request says — nothing has happened yet.
 *
 * 3. **With no trip, the request is `unplanned`.** Confirmed, a one-time aux
 *    truck minted, and no dispatcher has scheduled it. This is a real state the
 *    product could not previously show, and it has neither a timeout nor an
 *    alert.
 *
 * 4. **Once a trip exists, the TRIP wins.** `trip_requests.status` is never
 *    written again after confirm(), so it is frozen at 'confirmed' while the
 *    truck is out being loaded. Trusting it would report a moving transport as
 *    merely confirmed.
 *
 * `loaded` splits on the signature, because for an aux load "loaded" is not the
 * end — the external driver still has to sign the paper CMR through a one-time
 * public link, and "who still owes me a signature" is a question the dispatcher
 * actually asks.
 *
 * This never emits in_transit / arrived / delivering / delivered: an auxiliary
 * trip cannot reach them. Its lifecycle is collapsed (loaded -> completed, via
 * applyAuxiliaryLoadedSideEffects + a delayed auto-complete), so rendering those
 * would be a lie the UI tells about a state the backend cannot produce.
 */
export function composeAuxStage(row: AuxStageInput): AuxStage {
  const { status, tripStatus, tripSignedAt, tripCompletedAt } = row;

  if (status === RequestStatus.cancelled || tripStatus === TripStatus.cancelled) {
    return AuxStage.cancelled;
  }
  if (status === RequestStatus.pending) return AuxStage.pending;

  // Confirmed, but the dispatcher has not materialized a trip yet.
  if (!tripStatus) return AuxStage.unplanned;

  switch (tripStatus) {
    case TripStatus.planned:
      return AuxStage.planned;
    case TripStatus.loading:
      return AuxStage.loading;
    case TripStatus.loaded:
      return tripSignedAt ? AuxStage.signed : AuxStage.awaitingSignature;
    case TripStatus.completed:
      return AuxStage.completed;
    default:
      // A status an aux trip should not be able to reach (in_transit, arrived,
      // delivering, delivered, disputed). Rather than render a stage that lies,
      // fall back to the strongest evidence we actually have.
      if (tripCompletedAt) return AuxStage.completed;
      return tripSignedAt ? AuxStage.signed : AuxStage.planned;
  }
}

/** Sort key for the stage column. Unknown stages sort last rather than to 0. */
export function auxStageOrder(stage: AuxStage): number {
  const i = AUX_STAGE_ORDER.indexOf(stage);
  return i === -1 ? AUX_STAGE_ORDER.length : i;
}

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
  /** trips.public_sign_token_used_at — when the arrival CMR was uploaded. */
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
 * `loaded` means "awaiting the arrival CMR" — the external driver still has to
 * upload a photo of it through a one-time public link once the load reaches
 * its destination, and "who still owes me that CMR" is a question the
 * dispatcher actually asks. There is no further split beyond this: the upload
 * completes the trip in the same transaction that records it
 * (`completeAuxiliaryOnArrivalCmr`), so an "uploaded but still loaded" moment
 * cannot be observed — unlike the old electronic-signature flow, which left the
 * trip `loaded` for up to 5 more minutes after signing.
 *
 * This never emits in_transit / arrived / delivering / delivered: an auxiliary
 * trip cannot reach them. Its lifecycle is collapsed (loaded -> completed, via
 * applyAuxiliaryLoadedSideEffects + the arrival-CMR upload), so rendering those
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
      return AuxStage.awaitingArrivalCmr;
    case TripStatus.completed:
      return AuxStage.completed;
    default:
      // A status an aux trip should not be able to reach (in_transit, arrived,
      // delivering, delivered, disputed). Rather than render a stage that lies,
      // fall back to the strongest evidence we actually have: either mark of
      // completion (the arrival CMR is only ever recorded alongside completion,
      // so its presence here is itself evidence of it) means completed.
      if (tripCompletedAt || tripSignedAt) return AuxStage.completed;
      return AuxStage.planned;
  }
}

/** Sort key for the stage column. Unknown stages sort last rather than to 0. */
export function auxStageOrder(stage: AuxStage): number {
  const i = AUX_STAGE_ORDER.indexOf(stage);
  return i === -1 ? AUX_STAGE_ORDER.length : i;
}

/**
 * Stages at which an aux transport has not yet moved and may still be
 * deleted outright (as opposed to un-planned/cancelled — see
 * `TripRequestsService.deleteAuxRequest`).
 *
 * `loading` is excluded even though nothing has been carried yet: a loader is
 * actively working the truck on a phone, and deleting the request out from
 * under them would strand that screen. `awaitingArrivalCmr` is "loaded" in
 * TripStatus terms but the load has physically happened — excluded for the
 * same reason. `completed` is obviously excluded. `cancelled` stays deletable
 * so a transporter can clear cancelled rows out of their own ledger.
 */
export const DELETABLE_AUX_STAGES: readonly AuxStage[] = [
  AuxStage.pending,
  AuxStage.unplanned,
  AuxStage.planned,
  AuxStage.cancelled,
] as const;

/** Whether an aux transport at this stage may still be deleted (see above). */
export function canDeleteAuxStage(stage: AuxStage): boolean {
  return DELETABLE_AUX_STAGES.includes(stage);
}

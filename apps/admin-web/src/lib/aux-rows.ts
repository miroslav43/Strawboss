import type { TripRequest } from '@strawboss/types';
import { AuxStage } from '@strawboss/types';
import { composeAuxStage, auxStageOrder } from '@strawboss/domain';

/**
 * A row of the "Curse Aux" table.
 *
 * The row is keyed on the REQUEST, not on the trip. That is the whole design:
 * an auxiliary transport is born as a `trip_requests` row and its `trips` row is
 * only materialized later, when a dispatcher assigns the truck on the board. The
 * request id is therefore the only identity that is stable for the entity's
 * whole life, so a row never appears from nowhere, and never jumps tables, as
 * the transport progresses.
 *
 * It extends `Record<string, unknown>` so `DataTable<AuxRow>` compiles against
 * the EXISTING `<T extends Record<string, unknown>>` constraint. Widening that
 * generic instead would recompile six unrelated report and document tables for
 * no benefit.
 *
 * `stageOrder` is flattened to a plain number because DataTable sorts with
 * `row[sortKey]` and has no accessor — sorting the stage column by the enum's
 * string value would order it alphabetically (anulată, de semnat, finalizată…),
 * which is meaningless. A numeric ordinal sorts by lifecycle.
 *
 * `request` carries the real `TripRequest` through untouched, so the confirm /
 * cancel / aviz / CMR / details modals — which all take a full TripRequest —
 * need zero rewiring.
 */
export interface AuxRow extends Record<string, unknown> {
  id: string;
  request: TripRequest;
  stage: AuxStage;
  /** Lifecycle ordinal, used as the stage column's sort key. */
  stageOrder: number;
}

export function buildAuxRow(request: TripRequest): AuxRow {
  const stage = composeAuxStage({
    status: request.status,
    tripStatus: request.tripStatus,
    tripSignedAt: request.tripSignedAt,
    tripCompletedAt: request.tripCompletedAt,
  });
  return {
    id: request.id,
    request,
    stage,
    stageOrder: auxStageOrder(stage),
    // Flat mirrors of the fields the table sorts on. DataTable compares
    // `row[sortKey]` directly, so a sortable column must have its value at the
    // top level — reaching into `request` would compare objects.
    requesterName: request.companyName || request.requesterName,
    truckPlate: request.truckRegistrationPlate,
    driverName: request.driverName,
    tonsRequested: request.tonsRequested ?? null,
    neededDate: request.neededDate ?? null,
    tripNumber: request.tripNumber ?? null,
    createdAt: request.createdAt,
  };
}

export function buildAuxRows(requests: TripRequest[]): AuxRow[] {
  return requests.map(buildAuxRow);
}

import { setup, assign, createActor } from 'xstate';
import { TripStatus } from '@strawboss/types';

export interface TripMachineContext {
  tripId: string;
  status: TripStatus;
  baleCount: number;
  hasBaleLoads: boolean;
  grossWeightKg: number | null;
  receiverName: string | null;
  receiverSignature: string | null;
  loaderId: string | null;
  loaderOperatorId: string | null;
  destinationName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

type StartLoadingEvent = {
  type: 'START_LOADING';
  loaderOperatorId: string;
  loaderId?: string;
};

type CompleteLoadingEvent = {
  type: 'COMPLETE_LOADING';
  baleCount?: number;
};

type RegisterLoadEvent = {
  type: 'REGISTER_LOAD';
  baleCount?: number;
};

type DepartEvent = {
  type: 'DEPART';
  destinationName?: string;
};

type ArriveEvent = {
  type: 'ARRIVE';
};

type StartDeliveryEvent = {
  type: 'START_DELIVERY';
};

type ConfirmDeliveryEvent = {
  type: 'CONFIRM_DELIVERY';
  grossWeightKg: number;
};

// Step 1 of the manned-depot flow: the operator starts unloading. Valid from
// `in_transit` too, not just `arrived` — the operator standing at the ramp is a
// better witness of arrival than a button the driver often forgets to press, so
// the service stamps `arrival_at` implicitly when it fires from `in_transit`.
type StartDepotUnloadEvent = {
  type: 'START_DEPOT_UNLOAD';
};

// Step 2: depot-operator confirmation. Valid from `in_transit`, `arrived` or
// `delivering`. The operator always reports a bale count; weights are optional
// everywhere (a depot may have no scale, a broken one, or simply not weigh this
// load). The service then collapses delivered→completed in one transaction.
//
// `in_transit` is deliberately allowed so a lost step-1 sync entry cannot strand
// a truck that has already been physically unloaded.
type ConfirmDeliveryAtDepotEvent = {
  type: 'CONFIRM_DELIVERY_AT_DEPOT';
  baleCount: number;
  grossWeightKg?: number | null;
  scaleBroken?: boolean;
  depotType?: 'principal' | 'temporary';
};

type CompleteEvent = {
  type: 'COMPLETE';
  receiverName: string;
  receiverSignature: string;
};

type CancelEvent = {
  type: 'CANCEL';
  cancellationReason: string;
  cancelledAt?: string;
};

type DisputeEvent = {
  type: 'DISPUTE';
};

type ResolveDisputeEvent = {
  type: 'RESOLVE_DISPUTE';
  resolvedTo: 'delivered' | 'completed';
};

type TripEvent =
  | StartLoadingEvent
  | CompleteLoadingEvent
  | RegisterLoadEvent
  | DepartEvent
  | ArriveEvent
  | StartDeliveryEvent
  | ConfirmDeliveryEvent
  | StartDepotUnloadEvent
  | ConfirmDeliveryAtDepotEvent
  | CompleteEvent
  | CancelEvent
  | DisputeEvent
  | ResolveDisputeEvent;

const defaultContext: TripMachineContext = {
  tripId: '',
  status: TripStatus.planned,
  baleCount: 0,
  hasBaleLoads: false,
  grossWeightKg: null,
  receiverName: null,
  receiverSignature: null,
  loaderId: null,
  loaderOperatorId: null,
  destinationName: null,
  cancelledAt: null,
  cancellationReason: null,
};

export const tripMachine = setup({
  types: {
    context: {} as TripMachineContext,
    events: {} as TripEvent,
    input: {} as Partial<TripMachineContext>,
  },
  guards: {
    hasLoaderOperatorId: ({ event }) => {
      return (
        event.type === 'START_LOADING' &&
        typeof event.loaderOperatorId === 'string' &&
        event.loaderOperatorId.length > 0
      );
    },
    hasBaleLoads: ({ context }) => {
      return context.hasBaleLoads === true;
    },
    hasGrossWeight: ({ event }) => {
      return (
        event.type === 'CONFIRM_DELIVERY' &&
        typeof event.grossWeightKg === 'number' &&
        event.grossWeightKg > 0
      );
    },
    /*
     * The bale count is the only thing a depot confirmation must carry.
     *
     * This guard used to require a gross weight unless the depot was explicitly
     * `temporary` or the operator ticked "scale broken", defaulting to the strict
     * case when `depotType` was absent. That made the weight a hard gate on the
     * one action that closes a trip, so a principal depot whose scale was busy,
     * unreachable for the trailer, or simply not used left the operator unable to
     * confirm a truck he had already unloaded. Weighing is now optional
     * everywhere and `scaleBroken` records that no weight was taken; the weight
     * itself is validated (tare <= gross) server-side when it IS supplied.
     */
    hasDepotConfirmInfo: ({ event }) => {
      if (event.type !== 'CONFIRM_DELIVERY_AT_DEPOT') return false;
      return typeof event.baleCount === 'number' && event.baleCount > 0;
    },
    hasReceiverInfo: ({ event }) => {
      return (
        event.type === 'COMPLETE' &&
        typeof event.receiverName === 'string' &&
        event.receiverName.length > 0 &&
        typeof event.receiverSignature === 'string' &&
        event.receiverSignature.length > 0
      );
    },
    hasCancellationReason: ({ event }) => {
      return (
        event.type === 'CANCEL' &&
        typeof event.cancellationReason === 'string' &&
        event.cancellationReason.length > 0
      );
    },
  },
}).createMachine({
  id: 'trip',
  initial: 'planned',
  context: ({ input }) => ({
    ...defaultContext,
    ...input,
  }),
  states: {
    planned: {
      entry: assign({ status: TripStatus.planned }),
      on: {
        START_LOADING: {
          target: 'loading',
          guard: 'hasLoaderOperatorId',
          actions: assign({
            loaderOperatorId: ({ event }) => event.loaderOperatorId,
            loaderId: ({ event }) => event.loaderId ?? null,
            status: TripStatus.loading,
          }),
        },
        REGISTER_LOAD: {
          target: 'loaded',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            status: TripStatus.loaded,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    loading: {
      entry: assign({ status: TripStatus.loading }),
      on: {
        COMPLETE_LOADING: {
          target: 'loaded',
          guard: 'hasBaleLoads',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            status: TripStatus.loaded,
          }),
        },
        REGISTER_LOAD: {
          target: 'loaded',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            status: TripStatus.loaded,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    loaded: {
      entry: assign({ status: TripStatus.loaded }),
      on: {
        DEPART: {
          target: 'in_transit',
          actions: assign({
            destinationName: ({ context, event }) =>
              event.destinationName ?? context.destinationName,
            status: TripStatus.in_transit,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    in_transit: {
      entry: assign({ status: TripStatus.in_transit }),
      on: {
        ARRIVE: {
          target: 'arrived',
          actions: assign({
            status: TripStatus.arrived,
          }),
        },
        // The depot operator may act on a truck that is physically at the ramp but
        // whose driver never pressed "Am ajuns". Both of these stamp arrival_at
        // server-side, so the trip never skips a phase in the record.
        START_DEPOT_UNLOAD: {
          target: 'delivering',
          actions: assign({
            status: TripStatus.delivering,
          }),
        },
        CONFIRM_DELIVERY_AT_DEPOT: {
          target: 'delivered',
          guard: 'hasDepotConfirmInfo',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            grossWeightKg: ({ event }) => event.grossWeightKg ?? null,
            status: TripStatus.delivered,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    arrived: {
      entry: assign({ status: TripStatus.arrived }),
      on: {
        START_DELIVERY: {
          target: 'delivering',
          actions: assign({
            status: TripStatus.delivering,
          }),
        },
        START_DEPOT_UNLOAD: {
          target: 'delivering',
          actions: assign({
            status: TripStatus.delivering,
          }),
        },
        CONFIRM_DELIVERY_AT_DEPOT: {
          target: 'delivered',
          guard: 'hasDepotConfirmInfo',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            grossWeightKg: ({ event }) => event.grossWeightKg ?? null,
            status: TripStatus.delivered,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    delivering: {
      entry: assign({ status: TripStatus.delivering }),
      on: {
        CONFIRM_DELIVERY: {
          target: 'delivered',
          guard: 'hasGrossWeight',
          actions: assign({
            grossWeightKg: ({ event }) => event.grossWeightKg,
            status: TripStatus.delivered,
          }),
        },
        CONFIRM_DELIVERY_AT_DEPOT: {
          target: 'delivered',
          guard: 'hasDepotConfirmInfo',
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            grossWeightKg: ({ event }) => event.grossWeightKg ?? null,
            status: TripStatus.delivered,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    delivered: {
      entry: assign({ status: TripStatus.delivered }),
      on: {
        COMPLETE: {
          target: 'completed',
          guard: 'hasReceiverInfo',
          actions: assign({
            receiverName: ({ event }) => event.receiverName,
            receiverSignature: ({ event }) => event.receiverSignature,
            status: TripStatus.completed,
          }),
        },
        DISPUTE: {
          target: 'disputed',
          actions: assign({
            status: TripStatus.disputed,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          guard: 'hasCancellationReason',
          actions: assign({
            cancellationReason: ({ event }) => event.cancellationReason,
            cancelledAt: ({ event }) => event.cancelledAt ?? new Date().toISOString(),
            status: TripStatus.cancelled,
          }),
        },
      },
    },
    completed: {
      entry: assign({ status: TripStatus.completed }),
      on: {
        DISPUTE: {
          target: 'disputed',
          actions: assign({
            status: TripStatus.disputed,
          }),
        },
      },
    },
    cancelled: {
      entry: assign({ status: TripStatus.cancelled }),
      type: 'final',
    },
    disputed: {
      entry: assign({ status: TripStatus.disputed }),
      on: {
        RESOLVE_DISPUTE: [
          {
            target: 'delivered',
            guard: ({ event }) => event.resolvedTo === 'delivered',
            actions: assign({
              status: TripStatus.delivered,
            }),
          },
          {
            target: 'completed',
            guard: ({ event }) => event.resolvedTo === 'completed',
            actions: assign({
              status: TripStatus.completed,
            }),
          },
        ],
      },
    },
  },
});

export function createTripMachine(initialContext: Partial<TripMachineContext>) {
  return createActor(tripMachine, {
    input: initialContext,
  });
}

/*
 * THIS is what the backend enforces. `TripsService.validateTransition` reads
 * `getAvailableTransitions()` below, which reads this literal — it never
 * interprets the XState machine above. The two are kept in step by hand, so a
 * transition added to the machine and NOT added here passes code review and then
 * fails in production with "not allowed from status". Edit both.
 */
const transitionMap: Record<string, string[]> = {
  [TripStatus.planned]: ['START_LOADING', 'REGISTER_LOAD', 'CANCEL'],
  [TripStatus.loading]: ['COMPLETE_LOADING', 'REGISTER_LOAD', 'CANCEL'],
  [TripStatus.loaded]: ['DEPART', 'CANCEL'],
  [TripStatus.in_transit]: ['ARRIVE', 'START_DEPOT_UNLOAD', 'CONFIRM_DELIVERY_AT_DEPOT', 'CANCEL'],
  [TripStatus.arrived]: [
    'START_DELIVERY',
    'START_DEPOT_UNLOAD',
    'CONFIRM_DELIVERY_AT_DEPOT',
    'CANCEL',
  ],
  [TripStatus.delivering]: ['CONFIRM_DELIVERY', 'CONFIRM_DELIVERY_AT_DEPOT', 'CANCEL'],
  [TripStatus.delivered]: ['COMPLETE', 'DISPUTE', 'CANCEL'],
  [TripStatus.completed]: ['DISPUTE'],
  [TripStatus.cancelled]: [],
  [TripStatus.disputed]: ['RESOLVE_DISPUTE'],
};

export function getAvailableTransitions(status: TripStatus): string[] {
  return transitionMap[status] ?? [];
}

/**
 * Auxiliary (one-time external) trucks have a collapsed 3-status lifecycle:
 * `planned → loaded → completed` (no depart/arrive/depot step, no app driver).
 * The loader finishing the load lands the trip on `loaded` — same as a normal
 * trip — and it stays there until the external driver uploads the arrival CMR
 * through the one-time public link, which completes the trip in the same
 * transaction (`TripsService.completeAuxiliaryOnArrivalCmr`). An admin can also
 * force-complete it (with a reason) if the driver never uploads.
 *
 * Single source of truth for the backend register-load branch — keep the SQL in
 * trips.service in step with this.
 */
export function registerLoadTargetStatus(_isAuxiliary: boolean): TripStatus {
  return TripStatus.loaded;
}

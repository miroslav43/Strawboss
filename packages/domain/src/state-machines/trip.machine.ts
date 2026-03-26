import { setup, assign, createActor } from "xstate";
import { TripStatus } from "@strawboss/types";

export interface TripMachineContext {
  tripId: string;
  status: TripStatus;
  baleCount: number;
  hasBaleLoads: boolean;
  departureOdometerKm: number | null;
  arrivalOdometerKm: number | null;
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
  type: "START_LOADING";
  loaderOperatorId: string;
  loaderId?: string;
};

type CompleteLoadingEvent = {
  type: "COMPLETE_LOADING";
  baleCount?: number;
};

type DepartEvent = {
  type: "DEPART";
  departureOdometerKm: number;
  destinationName?: string;
};

type ArriveEvent = {
  type: "ARRIVE";
  arrivalOdometerKm: number;
};

type StartDeliveryEvent = {
  type: "START_DELIVERY";
};

type ConfirmDeliveryEvent = {
  type: "CONFIRM_DELIVERY";
  grossWeightKg: number;
};

type CompleteEvent = {
  type: "COMPLETE";
  receiverName: string;
  receiverSignature: string;
};

type CancelEvent = {
  type: "CANCEL";
  cancellationReason: string;
  cancelledAt?: string;
};

type DisputeEvent = {
  type: "DISPUTE";
};

type ResolveDisputeEvent = {
  type: "RESOLVE_DISPUTE";
  resolvedTo: "delivered" | "completed";
};

type TripEvent =
  | StartLoadingEvent
  | CompleteLoadingEvent
  | DepartEvent
  | ArriveEvent
  | StartDeliveryEvent
  | ConfirmDeliveryEvent
  | CompleteEvent
  | CancelEvent
  | DisputeEvent
  | ResolveDisputeEvent;

const defaultContext: TripMachineContext = {
  tripId: "",
  status: TripStatus.planned,
  baleCount: 0,
  hasBaleLoads: false,
  departureOdometerKm: null,
  arrivalOdometerKm: null,
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
        event.type === "START_LOADING" &&
        typeof event.loaderOperatorId === "string" &&
        event.loaderOperatorId.length > 0
      );
    },
    hasBaleLoads: ({ context }) => {
      return context.hasBaleLoads === true;
    },
    hasDepartureOdometer: ({ event }) => {
      return (
        event.type === "DEPART" &&
        typeof event.departureOdometerKm === "number" &&
        event.departureOdometerKm >= 0
      );
    },
    hasArrivalOdometer: ({ event }) => {
      return (
        event.type === "ARRIVE" &&
        typeof event.arrivalOdometerKm === "number" &&
        event.arrivalOdometerKm >= 0
      );
    },
    hasGrossWeight: ({ event }) => {
      return (
        event.type === "CONFIRM_DELIVERY" &&
        typeof event.grossWeightKg === "number" &&
        event.grossWeightKg > 0
      );
    },
    hasReceiverInfo: ({ event }) => {
      return (
        event.type === "COMPLETE" &&
        typeof event.receiverName === "string" &&
        event.receiverName.length > 0 &&
        typeof event.receiverSignature === "string" &&
        event.receiverSignature.length > 0
      );
    },
    hasCancellationReason: ({ event }) => {
      return (
        event.type === "CANCEL" &&
        typeof event.cancellationReason === "string" &&
        event.cancellationReason.length > 0
      );
    },
  },
}).createMachine({
  id: "trip",
  initial: "planned",
  context: ({ input }) => ({
    ...defaultContext,
    ...input,
  }),
  states: {
    planned: {
      entry: assign({ status: TripStatus.planned }),
      on: {
        START_LOADING: {
          target: "loading",
          guard: "hasLoaderOperatorId",
          actions: assign({
            loaderOperatorId: ({ event }) => event.loaderOperatorId,
            loaderId: ({ event }) => event.loaderId ?? null,
            status: TripStatus.loading,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "loaded",
          guard: "hasBaleLoads",
          actions: assign({
            baleCount: ({ context, event }) => event.baleCount ?? context.baleCount,
            status: TripStatus.loaded,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "in_transit",
          guard: "hasDepartureOdometer",
          actions: assign({
            departureOdometerKm: ({ event }) => event.departureOdometerKm,
            destinationName: ({ context, event }) =>
              event.destinationName ?? context.destinationName,
            status: TripStatus.in_transit,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "arrived",
          guard: "hasArrivalOdometer",
          actions: assign({
            arrivalOdometerKm: ({ event }) => event.arrivalOdometerKm,
            status: TripStatus.arrived,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "delivering",
          actions: assign({
            status: TripStatus.delivering,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "delivered",
          guard: "hasGrossWeight",
          actions: assign({
            grossWeightKg: ({ event }) => event.grossWeightKg,
            status: TripStatus.delivered,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "completed",
          guard: "hasReceiverInfo",
          actions: assign({
            receiverName: ({ event }) => event.receiverName,
            receiverSignature: ({ event }) => event.receiverSignature,
            status: TripStatus.completed,
          }),
        },
        DISPUTE: {
          target: "disputed",
          actions: assign({
            status: TripStatus.disputed,
          }),
        },
        CANCEL: {
          target: "cancelled",
          guard: "hasCancellationReason",
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
          target: "disputed",
          actions: assign({
            status: TripStatus.disputed,
          }),
        },
      },
    },
    cancelled: {
      entry: assign({ status: TripStatus.cancelled }),
      type: "final",
    },
    disputed: {
      entry: assign({ status: TripStatus.disputed }),
      on: {
        RESOLVE_DISPUTE: [
          {
            target: "delivered",
            guard: ({ event }) => event.resolvedTo === "delivered",
            actions: assign({
              status: TripStatus.delivered,
            }),
          },
          {
            target: "completed",
            guard: ({ event }) => event.resolvedTo === "completed",
            actions: assign({
              status: TripStatus.completed,
            }),
          },
        ],
      },
    },
  },
});

export function createTripMachine(
  initialContext: Partial<TripMachineContext>,
) {
  return createActor(tripMachine, {
    input: initialContext,
  });
}

const transitionMap: Record<string, string[]> = {
  [TripStatus.planned]: ["START_LOADING", "CANCEL"],
  [TripStatus.loading]: ["COMPLETE_LOADING", "CANCEL"],
  [TripStatus.loaded]: ["DEPART", "CANCEL"],
  [TripStatus.in_transit]: ["ARRIVE", "CANCEL"],
  [TripStatus.arrived]: ["START_DELIVERY", "CANCEL"],
  [TripStatus.delivering]: ["CONFIRM_DELIVERY", "CANCEL"],
  [TripStatus.delivered]: ["COMPLETE", "DISPUTE", "CANCEL"],
  [TripStatus.completed]: ["DISPUTE"],
  [TripStatus.cancelled]: [],
  [TripStatus.disputed]: ["RESOLVE_DISPUTE"],
};

export function getAvailableTransitions(status: TripStatus): string[] {
  return transitionMap[status] ?? [];
}

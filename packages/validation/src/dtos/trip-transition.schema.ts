import { z } from 'zod';
import { uuidSchema } from '../helpers/uuid.js';

export const startLoadingSchema = z.object({
  loaderId: uuidSchema.optional(),
  loaderOperatorId: uuidSchema,
});

export const completeLoadingSchema = z.object({});

export const departSchema = z.object({
  driverSignature: z.string().min(1),
});

// Trip distance comes entirely from the GPS track (depart → arrive), so the
// arrive payload carries no fields.
export const arriveSchema = z.object({});

export const startDeliverySchema = z.object({
  destinationName: z.string().optional(),
});

export const confirmDeliverySchema = z
  .object({
    // Driver weighs the loaded truck (gross) and the empty truck (tare) at the
    // depot weighbridge; net = gross - tare is computed in the DB.
    grossWeightKg: z.number().positive(),
    tareWeightKg: z.number().nonnegative(),
    weightTicketNumber: z.string().optional(),
    // Weight-ticket photo was removed from the flow; kept optional for back-compat.
    weightTicketPhotoUrl: z.string().optional(),
    // Mobile sends `null` when the (now-removed) damaged-bales step is skipped —
    // accept null as well as a number/absent, otherwise confirm-delivery 400s.
    deterioratedBalesCount: z.number().int().min(0).nullable().optional(),
  })
  // Tare can never exceed gross (net would be negative). Reject instead of
  // letting the backend clamp it to net=0 on a legally binding CMR.
  .refine((d) => d.tareWeightKg <= d.grossWeightKg, {
    message: 'Tara nu poate depăși greutatea brută',
    path: ['tareWeightKg'],
  });

export const completeSchema = z.object({
  receiverName: z.string().min(1),
  receiverSignature: z.string().min(1),
});

/**
 * Depot-operator confirmation payload. `baleCount` is always required; weights
 * are optional (omitted on a temporary depot or when the scale is broken). The
 * depot-type rule — "principal depot with a working scale must send gross" — is
 * enforced server-side (the schema can't see the depot type). The cross-field
 * tare ≤ gross check applies only when both weights are present.
 */
export const confirmDepotDeliverySchema = z
  .object({
    baleCount: z.number().int().positive(),
    grossWeightKg: z.number().positive().nullable().optional(),
    tareWeightKg: z.number().nonnegative().nullable().optional(),
    scaleBroken: z.boolean().optional(),
    depotOperatorSignature: z.string().min(1),
    idempotencyKey: uuidSchema,
  })
  .refine(
    (d) => d.grossWeightKg == null || d.tareWeightKg == null || d.tareWeightKg <= d.grossWeightKg,
    {
      message: 'Tara nu poate depăși greutatea brută',
      path: ['tareWeightKg'],
    },
  );

export const cancelSchema = z.object({
  cancellationReason: z.string().min(1),
});

/**
 * Admin-only manual status override. Bypasses the state machine — lets an admin
 * force a trip into any status to recover from stuck/edge situations.
 */
const tripStatusEnum = z.enum([
  'planned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivering',
  'delivered',
  'completed',
  'cancelled',
  'disputed',
]);

export const forceStatusSchema = z.object({
  status: tripStatusEnum,
  reason: z.string().optional(),
  expectedStatus: tripStatusEnum.optional(),
});

export const disputeSchema = z.object({
  reason: z.string().min(1),
});

export const resolveDisputeSchema = z.object({
  resolutionNotes: z.string().min(1),
  resolvedTo: z.enum(['delivered', 'completed']),
});

/**
 * Atomic loader "register load" payload — finds or creates the trip for
 * (truck, today), inserts a `bale_loads` row, and transitions the trip to
 * `loaded` in a single transaction.
 *
 * `idempotencyKey` is the client-side bale_load UUID so retries dedupe.
 */
export const registerLoadSchema = z
  .object({
    truckId: uuidSchema,
    loaderMachineId: uuidSchema,
    parcelId: uuidSchema.optional(),
    sourceDepotId: uuidSchema.optional(),
    baleCount: z.number().int().positive(),
    gpsLat: z.number().min(-90).max(90).optional(),
    gpsLon: z.number().min(-180).max(180).optional(),
    idempotencyKey: uuidSchema,
    loaderSignature: z.string().optional(),
  })
  .refine((d) => !!d.parcelId !== !!d.sourceDepotId, {
    message: 'exactly one of parcelId or sourceDepotId is required',
  });

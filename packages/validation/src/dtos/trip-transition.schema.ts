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

export const confirmDeliverySchema = z.object({
  grossWeightKg: z.number().positive(),
  weightTicketNumber: z.string().optional(),
  weightTicketPhotoUrl: z.string().optional(),
  // Mobile sends `null` when the (now-removed) damaged-bales step is skipped —
  // accept null as well as a number/absent, otherwise confirm-delivery 400s.
  deterioratedBalesCount: z.number().int().min(0).nullable().optional(),
});

export const completeSchema = z.object({
  receiverName: z.string().min(1),
  receiverSignature: z.string().min(1),
});

export const cancelSchema = z.object({
  cancellationReason: z.string().min(1),
});

/**
 * Admin-only manual status override. Bypasses the state machine — lets an admin
 * force a trip into any status to recover from stuck/edge situations.
 */
export const forceStatusSchema = z.object({
  status: z.enum([
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
  ]),
  reason: z.string().optional(),
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
export const registerLoadSchema = z.object({
  truckId: uuidSchema,
  loaderMachineId: uuidSchema,
  parcelId: uuidSchema,
  baleCount: z.number().int().positive(),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLon: z.number().min(-180).max(180).optional(),
  idempotencyKey: uuidSchema,
  loaderSignature: z.string().optional(),
});

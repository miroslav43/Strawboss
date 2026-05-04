import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";

export const startLoadingSchema = z.object({
  loaderId: uuidSchema.optional(),
  loaderOperatorId: uuidSchema,
});

export const completeLoadingSchema = z.object({});

export const departSchema = z.object({
  departureOdometerKm: z.number().nonnegative(),
});

export const arriveSchema = z.object({
  arrivalOdometerKm: z.number().nonnegative(),
});

export const startDeliverySchema = z.object({
  destinationName: z.string().optional(),
});

export const confirmDeliverySchema = z.object({
  grossWeightKg: z.number().positive(),
  weightTicketNumber: z.string().optional(),
});

export const completeSchema = z.object({
  receiverName: z.string().min(1),
  receiverSignature: z.string().min(1),
});

export const cancelSchema = z.object({
  cancellationReason: z.string().min(1),
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
});

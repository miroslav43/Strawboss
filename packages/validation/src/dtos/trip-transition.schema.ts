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

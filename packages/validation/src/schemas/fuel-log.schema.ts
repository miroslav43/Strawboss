import { z } from "zod";
import { FuelType } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";
import { fuelTypeSchema } from "./machine.schema.js";

export const fuelLogSchema = z
  .object({
    id: uuidSchema,
    machineId: uuidSchema,
    operatorId: uuidSchema,
    parcelId: uuidSchema.nullable(),
    loggedAt: isoDateSchema,
    fuelType: fuelTypeSchema,
    quantityLiters: z.number().positive(),
    unitPrice: z.number().nonnegative().nullable(),
    totalCost: z.number().nonnegative().nullable(),
    odometerKm: z.number().nonnegative().nullable(),
    hourmeterHrs: z.number().nonnegative().nullable(),
    isFullTank: z.boolean(),
    receiptPhotoUrl: z.string().url().nullable(),
    notes: z.string().nullable(),
    clientId: z.string().nullable(),
    syncVersion: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createFuelLogSchema = z.object({
  machineId: uuidSchema,
  operatorId: uuidSchema,
  parcelId: uuidSchema.nullable().optional(),
  loggedAt: isoDateSchema,
  fuelType: fuelTypeSchema,
  quantityLiters: z.number().positive(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  totalCost: z.number().nonnegative().nullable().optional(),
  odometerKm: z.number().nonnegative().nullable().optional(),
  hourmeterHrs: z.number().nonnegative().nullable().optional(),
  isFullTank: z.boolean(),
  receiptPhotoUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});

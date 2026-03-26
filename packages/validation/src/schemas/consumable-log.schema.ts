import { z } from "zod";
import { ConsumableType } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const consumableTypeSchema = z.nativeEnum(ConsumableType);

export const consumableLogSchema = z
  .object({
    id: uuidSchema,
    machineId: uuidSchema,
    operatorId: uuidSchema,
    parcelId: uuidSchema.nullable(),
    consumableType: consumableTypeSchema,
    description: z.string().nullable(),
    quantity: z.number().positive(),
    unit: z.string().min(1),
    unitPrice: z.number().nonnegative().nullable(),
    totalCost: z.number().nonnegative().nullable(),
    loggedAt: isoDateSchema,
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createConsumableLogSchema = z.object({
  machineId: uuidSchema,
  operatorId: uuidSchema,
  parcelId: uuidSchema.nullable().optional(),
  consumableType: consumableTypeSchema,
  description: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPrice: z.number().nonnegative().nullable().optional(),
  totalCost: z.number().nonnegative().nullable().optional(),
  loggedAt: isoDateSchema,
});

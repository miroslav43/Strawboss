import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const baleProductionSchema = z
  .object({
    id: uuidSchema,
    parcelId: uuidSchema,
    balerId: uuidSchema,
    operatorId: uuidSchema,
    productionDate: z.string().min(1),
    baleCount: z.number().int().positive(),
    avgBaleWeightKg: z.number().positive().nullable(),
    startTime: isoDateSchema.nullable(),
    endTime: isoDateSchema.nullable(),
    farmtrackSessionId: z.string().nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createBaleProductionSchema = z.object({
  parcelId: uuidSchema,
  balerId: uuidSchema,
  operatorId: uuidSchema,
  productionDate: z.string().min(1),
  baleCount: z.number().int().positive(),
  avgBaleWeightKg: z.number().positive().nullable().optional(),
  startTime: isoDateSchema.nullable().optional(),
  endTime: isoDateSchema.nullable().optional(),
  farmtrackSessionId: z.string().nullable().optional(),
});

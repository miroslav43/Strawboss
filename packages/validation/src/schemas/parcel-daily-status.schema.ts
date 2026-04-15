import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";

export const parcelDailyStatusSchema = z.object({
  id: uuidSchema,
  parcelId: uuidSchema,
  statusDate: z.string().min(1),
  isDone: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const upsertParcelDailyStatusSchema = z.object({
  parcelId: uuidSchema,
  statusDate: z.string().min(1),
  isDone: z.boolean(),
  notes: z.string().nullable().optional(),
});

import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const baleLoadSchema = z
  .object({
    id: uuidSchema,
    tripId: uuidSchema,
    parcelId: uuidSchema,
    loaderId: uuidSchema,
    operatorId: uuidSchema,
    baleCount: z.number().int().positive(),
    loadedAt: isoDateSchema,
    gpsLat: z.number().min(-90).max(90).nullable(),
    gpsLon: z.number().min(-180).max(180).nullable(),
    farmtrackEventId: z.string().nullable(),
    notes: z.string().nullable(),
    clientId: z.string().nullable(),
    syncVersion: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createBaleLoadSchema = z.object({
  tripId: uuidSchema,
  parcelId: uuidSchema,
  loaderId: uuidSchema,
  operatorId: uuidSchema,
  baleCount: z.number().int().positive(),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLon: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
});

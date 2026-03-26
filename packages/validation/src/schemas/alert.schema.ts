import { z } from "zod";
import { AlertCategory, AlertSeverity } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { timestampsSchema } from "../helpers/common.js";

export const alertCategorySchema = z.nativeEnum(AlertCategory);
export const alertSeveritySchema = z.nativeEnum(AlertSeverity);

export const alertSchema = z
  .object({
    id: uuidSchema,
    category: alertCategorySchema,
    severity: alertSeveritySchema,
    title: z.string().min(1),
    description: z.string().min(1),
    relatedTable: z.string().nullable(),
    relatedRecordId: uuidSchema.nullable(),
    tripId: uuidSchema.nullable(),
    machineId: uuidSchema.nullable(),
    data: z.record(z.unknown()).nullable(),
    isAcknowledged: z.boolean(),
    acknowledgedBy: uuidSchema.nullable(),
    acknowledgedAt: isoDateSchema.nullable(),
    resolutionNotes: z.string().nullable(),
  })
  .merge(timestampsSchema);

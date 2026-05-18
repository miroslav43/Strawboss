import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";

export const fieldReportSchema = z.object({
  parcelId: uuidSchema,
  parcelName: z.string(),
  parcelCode: z.string(),
  produced: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  lossPercentage: z.number(),
});

export const farmReportSchema = z.object({
  farmId: uuidSchema.nullable(),
  farmName: z.string(),
  fieldCount: z.number().int().nonnegative(),
  produced: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  lossPercentage: z.number(),
  fields: z.array(fieldReportSchema),
});

export const depotReportSchema = z.object({
  depotId: uuidSchema,
  depotName: z.string(),
  depotCode: z.string(),
  totalStock: z.number().int().nonnegative(),
  receivedInPeriod: z.number().int().nonnegative(),
  arrivingNow: z.number().int().nonnegative(),
  deliveryCount: z.number().int().nonnegative(),
});

export const reportTimelinePointSchema = z.object({
  date: isoDateSchema,
  produced: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
});

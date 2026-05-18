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

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");

export const reportQuerySchema = z.object({
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  farmId: uuidSchema.optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

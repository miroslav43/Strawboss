import { z } from 'zod';
import { uuidSchema } from '../helpers/uuid.js';
import { isoDateSchema } from '../helpers/iso-date.js';

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

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date');

export const reportQuerySchema = z.object({
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  farmId: uuidSchema.optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

/**
 * T18 — bulk truck-distance report query.
 *
 * `from` and `to` are inclusive ISO dates. `machineId` narrows the report to
 * a single truck (otherwise all trucks in the org are returned). Range is
 * capped at 90 days to match the server-side limit in ReportsService.
 */
export const truckDistanceQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    machineId: uuidSchema.optional(),
  })
  .refine(
    (d) => {
      const diff = (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000;
      return diff >= 0 && diff <= 90;
    },
    { message: 'Range must be 0–90 days with from ≤ to' },
  );

export type TruckDistanceQuery = z.infer<typeof truckDistanceQuerySchema>;

/**
 * Per-operator GPS-distance report query. Mirrors the truck-distance query but
 * narrows by driver instead of machine. `from`/`to` are inclusive ISO dates,
 * capped at 90 days to match the server-side limit.
 */
export const operatorDistanceQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    operatorId: uuidSchema.optional(),
  })
  .refine(
    (d) => {
      const diff = (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000;
      return diff >= 0 && diff <= 90;
    },
    { message: 'Range must be 0–90 days with from ≤ to' },
  );

export type OperatorDistanceQuery = z.infer<typeof operatorDistanceQuerySchema>;

/**
 * Plan A T4 — connected-hours admin report query.
 *
 * `from` and `to` are inclusive ISO dates. `groupBy` picks the bucket size
 * (day / ISO-week / calendar month). Sessions that span a bucket boundary are
 * clipped on the server. Range is capped at 366 days to keep the periods CTE
 * bounded.
 */
export const connectedHoursQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  })
  .refine(
    (d) => {
      const diff = (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000;
      return diff >= 0 && diff <= 366;
    },
    { message: 'Range must be 0–366 days with from ≤ to' },
  );

export type ConnectedHoursQuery = z.infer<typeof connectedHoursQuerySchema>;

/** Plan A T4 — one row in the connected-hours report. */
export const connectedHoursRowSchema = z.object({
  userId: uuidSchema,
  userName: z.string(),
  role: z.string(),
  /** Bucket label ('YYYY-MM-DD' / 'IYYY-"W"IW' / 'YYYY-MM') from the server. */
  period: z.string(),
  /** ISO 8601 UTC timestamp marking the start of the bucket. */
  periodStart: isoDateSchema,
  hours: z.number().nonnegative(),
});

export const connectedHoursReportSchema = z.object({
  groupBy: z.enum(['day', 'week', 'month']),
  from: dateOnlySchema,
  to: dateOnlySchema,
  rows: z.array(connectedHoursRowSchema),
});

import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";

/**
 * Meteo module request schemas. Units follow packages/types entities/meteo.ts:
 * moisture fractions are wet basis (0..1), EXCEPT `moisturePct` on the reading
 * create body, which is percent so a field operator types "17.5", not "0.175".
 */

const isoDateTime = z.string().datetime({ offset: true });
const MAX_DRYING_CLOCK_AGE_MS = 28 * 24 * 3_600_000;

const fraction = (min: number, max: number) => z.number().gt(min).lt(max);

export const swathTypeSchema = z.enum(["narrow", "wide", "turned"]);
export const moistureReadingKindSchema = z.enum(["swath", "bale"]);

export const updateMeteoSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    thresholdWb: fraction(0.05, 0.4).optional(),
    baleableFracMin: z.number().min(0.5).max(1).optional(),
    rainProbMax: fraction(0, 1).optional(),
    pressCapacityHaH: z.number().gt(0).max(50).optional(),
    minWindowH: z.number().int().min(1).max(24).optional(),
    defaultMc0Wb: fraction(0.05, 0.7).optional(),
    activeDays: z.number().int().min(1).max(28).optional(),
  })
  .strict();

/** A drying-clock start: no later than now, no earlier than 28 days ago. */
const harvestedAtSchema = isoDateTime.refine(
  (v) => {
    const t = Date.parse(v);
    const now = Date.now();
    return t <= now + 5 * 60_000 && t >= now - MAX_DRYING_CLOCK_AGE_MS;
  },
  { message: "harvestedAt must be within the last 28 days and not in the future" },
);

export const createHarvestEventSchema = z
  .object({
    parcelId: uuidSchema,
    harvestedAt: harvestedAtSchema,
    swathType: swathTypeSchema.optional(),
    fromAuditHint: z.boolean().optional(),
  })
  .strict();

export const updateHarvestEventSchema = z
  .object({
    harvestedAt: harvestedAtSchema.optional(),
    swathType: swathTypeSchema.optional(),
  })
  .strict()
  .refine((v) => v.harvestedAt !== undefined || v.swathType !== undefined, {
    message: "nothing to update",
  });

/**
 * `measuredAt` comes from a phone clock that may run a little fast — accept up
 * to +24 h here as a sanity cap; the service clamps it to the server's now().
 */
export const createMoistureReadingSchema = z
  .object({
    id: uuidSchema,
    parcelId: uuidSchema,
    measuredAt: isoDateTime.refine((v) => Date.parse(v) <= Date.now() + 24 * 3_600_000, {
      message: "measuredAt is too far in the future",
    }),
    moisturePct: z.number().gt(0).lt(100),
    kind: moistureReadingKindSchema,
    baleProductionId: uuidSchema.nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    source: z.enum(["web", "mobile"]),
  })
  .strict();

export const meteoParcelQuerySchema = z.object({
  hours: z.coerce.number().int().min(24).max(168).optional(),
});

export type UpdateMeteoSettingsInput = z.infer<typeof updateMeteoSettingsSchema>;
export type CreateHarvestEventInput = z.infer<typeof createHarvestEventSchema>;
export type UpdateHarvestEventInput = z.infer<typeof updateHarvestEventSchema>;
export type CreateMoistureReadingInput = z.infer<typeof createMoistureReadingSchema>;

// ── Iteration 2 ─────────────────────────────────────────────────────────────

export const meteoWeatherQuerySchema = z.object({
  view: z.enum(["full", "compact"]).optional(),
});

export const meteoAlertsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
});

/** Ranges are identical to meteo_org_settings_alerts_chk (migration 00101). */
export const updateMeteoAlertSettingsSchema = z
  .object({
    alertsEnabled: z.boolean().optional(),
    alertsEmail: z.boolean().optional(),
    frostC: z.number().min(-10).max(5).optional(),
    heatC: z.number().min(25).max(45).optional(),
    gustMs: z.number().min(8).max(40).optional(),
    rainMm: z.number().min(5).max(200).optional(),
    capeJkg: z.number().int().min(300).max(5000).optional(),
    lookaheadH: z.number().int().min(24).max(48).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

export const meteoAlertEvaluateQuerySchema = z.object({
  dryRun: z.enum(["true", "false"]).optional(),
});

export type MeteoWeatherQuery = z.infer<typeof meteoWeatherQuerySchema>;
export type UpdateMeteoAlertSettingsInput = z.infer<typeof updateMeteoAlertSettingsSchema>;

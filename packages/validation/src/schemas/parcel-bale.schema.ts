import { z } from 'zod';
import { uuidSchema } from '../helpers/uuid.js';

/**
 * Body for `POST /api/v1/parcels/:id/override-bales`. Each field is the TARGET
 * absolute total; the backend records the signed delta needed to reach it. At
 * least one of `produced` / `loaded` must be present.
 */
export const overrideBalesSchema = z
  .object({
    produced: z.number().int().min(0).optional(),
    loaded: z.number().int().min(0).optional(),
    reason: z.string().max(2000).optional(),
    balerId: uuidSchema.optional(),
  })
  .refine((d) => d.produced !== undefined || d.loaded !== undefined, {
    message: 'At least one of produced or loaded must be provided',
  });

/** Body for `POST /api/v1/parcels/:id/transfer-to-depot`. */
export const transferToDepotSchema = z.object({
  destinationId: uuidSchema,
  baleCount: z.number().int().positive(),
});

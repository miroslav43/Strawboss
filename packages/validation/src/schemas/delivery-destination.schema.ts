import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { geoPointSchema } from "../helpers/geo.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const deliveryDestinationSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    address: z.string().min(1),
    coords: geoPointSchema.nullable(),
    contactName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().email().nullable(),
    isActive: z.boolean(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createDeliveryDestinationSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  coords: geoPointSchema.nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
});

export const updateDeliveryDestinationSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    address: z.string().min(1),
    coords: geoPointSchema.nullable(),
    contactName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().email().nullable(),
    isActive: z.boolean(),
  })
  .partial();

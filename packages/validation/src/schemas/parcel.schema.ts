import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { geoPointSchema } from "../helpers/geo.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const harvestStatusSchema = z.enum([
  "planned",
  "to_harvest",
  "harvesting",
  "harvested",
]);

export const parcelSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    ownerName: z.string().min(1),
    ownerContact: z.string().nullable(),
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    harvestStatus: harvestStatusSchema,
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createParcelSchema = z.object({
  // code and name are generated/set automatically; both optional at create time.
  code:                z.string().min(1).optional(),
  name:                z.string().min(1).optional(),
  ownerName:           z.string().optional(),
  ownerContact:        z.string().nullable().optional(),
  areaHectares:        z.number().positive().optional(),
  boundary:            z.string().nullable().optional(),
  centroid:            geoPointSchema.nullable().optional(),
  address:             z.string().optional(),
  municipality:        z.string().optional(),
  farmtrackGeofenceId: z.string().nullable().optional(),
  notes:               z.string().nullable().optional(),
  harvestStatus:       harvestStatusSchema.optional(),
});

export const updateParcelSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    ownerName: z.string().min(1),
    ownerContact: z.string().nullable(),
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    farmId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    harvestStatus: harvestStatusSchema,
  })
  .partial();

import { z } from 'zod';
import { uuidSchema } from '../helpers/uuid.js';
import { geoPointSchema } from '../helpers/geo.js';
import { timestampsSchema } from '../helpers/common.js';
import { softDeleteSchema } from '../helpers/common.js';

export const harvestStatusSchema = z.enum([
  'planned',
  'to_harvest',
  'harvesting',
  'partial_harvested',
  'harvested',
  'in_loading',
  'loaded',
  'completed',
]);

export const cropTypeSchema = z.enum(['grau', 'orz', 'rapita', 'plante_nutret']);

export const parcelSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    harvestStatus: harvestStatusSchema,
    farmId: z.string().uuid().nullable(),
    cropType: cropTypeSchema.nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createParcelSchema = z.object({
  // code and name are generated/set automatically; both optional at create time.
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  areaHectares: z.number().positive().optional(),
  boundary: z.string().nullable().optional(),
  centroid: geoPointSchema.nullable().optional(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  farmtrackGeofenceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  harvestStatus: harvestStatusSchema.optional(),
  cropType: cropTypeSchema.nullable().optional(),
  farmId: z.string().uuid().nullable().optional(),
});

/** One parcel in a bulk KML import. `code` is required (upsert key). */
export const importParcelSchema = z.object({
  code: z.string().min(1).max(128),
  name: z.string().min(1).max(256).optional(),
  // Stringified GeoJSON Polygon. Required — a parcel without a boundary is
  // meaningless to import. Capped well above any real polygon to bound per-row
  // PostGIS work and keep logs/error strings sane. Refined to reject anything
  // that is not a `Polygon` so we surface a clear error before PostGIS
  // (the `parcels.boundary` column is `GEOMETRY(Polygon, 4326)`).
  boundary: z
    .string()
    .min(1)
    .max(500_000)
    .refine(
      (s) => {
        try {
          const g = JSON.parse(s) as { type?: unknown };
          return g != null && typeof g === 'object' && g.type === 'Polygon';
        } catch {
          return false;
        }
      },
      { message: 'boundary must be a GeoJSON Polygon string' },
    ),
  areaHectares: z.number().positive().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** Body for `POST /api/v1/parcels/import`. */
export const importParcelsSchema = z.object({
  farmId: z.string().uuid().nullable().optional(),
  parcels: z.array(importParcelSchema).min(1).max(500),
});

export const updateParcelSchema = z
  .object({
    code: z.string().min(1),
    // name accepted but UI no longer surfaces it (T9.3 deprecation).
    name: z.string().min(1),
    areaHectares: z.number().positive(),
    boundary: z.string().nullable(),
    centroid: geoPointSchema.nullable(),
    address: z.string().min(1),
    municipality: z.string().min(1),
    farmtrackGeofenceId: z.string().nullable(),
    farmId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    // isActive accepted but ignored server-side (T9.2 deprecation).
    isActive: z.boolean(),
    harvestStatus: harvestStatusSchema,
    cropType: cropTypeSchema.nullable(),
  })
  .partial();

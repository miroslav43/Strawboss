import { z } from "zod";
import { uuidSchema } from "../helpers/uuid.js";
import { geoPointSchema } from "../helpers/geo.js";

export const tripCreateDtoSchema = z.object({
  sourceParcelId: uuidSchema,
  truckId: uuidSchema,
  driverId: uuidSchema,
  loaderId: uuidSchema.optional(),
  loaderOperatorId: uuidSchema.optional(),
  destinationName: z.string().optional(),
  destinationAddress: z.string().optional(),
  destinationCoords: geoPointSchema.optional(),
});

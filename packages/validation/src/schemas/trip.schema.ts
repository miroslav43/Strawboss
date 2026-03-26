import { z } from "zod";
import { TripStatus } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { isoDateSchema } from "../helpers/iso-date.js";
import { geoPointSchema } from "../helpers/geo.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

export const tripStatusSchema = z.nativeEnum(TripStatus);

export const tripSchema = z
  .object({
    id: uuidSchema,
    tripNumber: z.string().min(1),
    status: tripStatusSchema,
    sourceParcelId: uuidSchema,
    sourceParcelAuto: z.boolean(),
    loaderId: uuidSchema.nullable(),
    truckId: uuidSchema,
    loaderOperatorId: uuidSchema.nullable(),
    driverId: uuidSchema,
    baleCount: z.number().int().nonnegative(),
    loadingStartedAt: isoDateSchema.nullable(),
    loadingCompletedAt: isoDateSchema.nullable(),
    departureOdometerKm: z.number().nonnegative().nullable(),
    departureAt: isoDateSchema.nullable(),
    arrivalOdometerKm: z.number().nonnegative().nullable(),
    arrivalAt: isoDateSchema.nullable(),
    gpsDistanceKm: z.number().nonnegative().nullable(),
    destinationName: z.string().nullable(),
    destinationAddress: z.string().nullable(),
    destinationCoords: geoPointSchema.nullable(),
    grossWeightKg: z.number().nonnegative().nullable(),
    tareWeightKg: z.number().nonnegative().nullable(),
    netWeightKg: z.number().nullable(),
    weightTicketNumber: z.string().nullable(),
    weightTicketPhotoUrl: z.string().url().nullable(),
    deliveredAt: isoDateSchema.nullable(),
    deliveryNotes: z.string().nullable(),
    receiverName: z.string().nullable(),
    receiverSignatureUrl: z.string().url().nullable(),
    receiverSignedAt: isoDateSchema.nullable(),
    completedAt: isoDateSchema.nullable(),
    cancelledAt: isoDateSchema.nullable(),
    cancellationReason: z.string().nullable(),
    odometerDistanceKm: z.number().nonnegative().nullable(),
    distanceDiscrepancyKm: z.number().nullable(),
    fraudFlags: z.record(z.unknown()).nullable(),
    clientId: z.string().nullable(),
    syncVersion: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

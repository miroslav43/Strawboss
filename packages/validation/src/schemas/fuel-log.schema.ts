import { z } from 'zod';
import { FuelType } from '@strawboss/types';
import { uuidSchema } from '../helpers/uuid.js';
import { isoDateSchema } from '../helpers/iso-date.js';
import { timestampsSchema } from '../helpers/common.js';
import { softDeleteSchema } from '../helpers/common.js';
import { fuelTypeSchema } from './machine.schema.js';

export const fuelLogSchema = z
  .object({
    id: uuidSchema,
    machineId: uuidSchema,
    operatorId: uuidSchema,
    parcelId: uuidSchema.nullable(),
    loggedAt: isoDateSchema,
    fuelType: fuelTypeSchema,
    quantityLiters: z.number().positive(),
    unitPrice: z.number().nonnegative().nullable(),
    totalCost: z.number().nonnegative().nullable(),
    hourmeterHrs: z.number().nonnegative().nullable(),
    isFullTank: z.boolean(),
    receiptPhotoUrl: z.string().url().nullable(),
    notes: z.string().nullable(),
    clientId: z.string().nullable(),
    syncVersion: z.number().int().nonnegative(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createFuelLogSchema = z.object({
  machineId: uuidSchema,
  operatorId: uuidSchema,
  parcelId: uuidSchema.nullable().optional(),
  loggedAt: isoDateSchema,
  fuelType: fuelTypeSchema,
  quantityLiters: z.number().positive(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  totalCost: z.number().nonnegative().nullable().optional(),
  hourmeterHrs: z.number().nonnegative().nullable().optional(),
  isFullTank: z.boolean(),
  receiptPhotoUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Partial update DTO for the admin web edit flow (PATCH /fuel-logs/:id).
 * Every remaining field is optional; the service only applies keys present in
 * the body. `machineId`/`operatorId`/`parcelId` are intentionally NOT editable:
 * they are bare cross-org FKs (a fuel log stays tied to its machine, and its
 * attribution/parcel is fixed at creation), so leaving them out of the contract
 * keeps an admin from repointing a log at another organization's row.
 */
export const updateFuelLogSchema = createFuelLogSchema
  .partial()
  .omit({ machineId: true, operatorId: true, parcelId: true });

import { z } from 'zod';
import { MachineType, FuelType } from '@strawboss/types';
import { uuidSchema } from '../helpers/uuid.js';
import { timestampsSchema } from '../helpers/common.js';
import { softDeleteSchema } from '../helpers/common.js';

export const machineTypeSchema = z.nativeEnum(MachineType);
export const fuelTypeSchema = z.nativeEnum(FuelType);

export const machineSchema = z
  .object({
    id: uuidSchema,
    machineType: machineTypeSchema,
    registrationPlate: z.string().min(1),
    internalCode: z.string().min(1),
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    fuelType: fuelTypeSchema,
    tankCapacityLiters: z.number().nonnegative(),
    farmtrackDeviceId: z.string().nullable(),
    currentHourmeterHrs: z.number().nonnegative(),
    isActive: z.boolean(),
    maxBaleCount: z.number().int().positive().nullable(),
    tareWeightKg: z.number().nonnegative().nullable(),
    baleWeightAvgKg: z.number().positive().nullable(),
    ownerCompanyName: z.string().nullable(),
    ownerCompanyAddress: z.string().nullable(),
    ownerCompanyCui: z.string().nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createMachineSchema = z.object({
  machineType: machineTypeSchema,
  registrationPlate: z.string().min(1),
  internalCode: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  fuelType: fuelTypeSchema,
  tankCapacityLiters: z.number().nonnegative(),
  farmtrackDeviceId: z.string().nullable().optional(),
  currentHourmeterHrs: z.number().nonnegative().optional(),
  maxBaleCount: z.number().int().positive().nullable().optional(),
  tareWeightKg: z.number().nonnegative().nullable().optional(),
  baleWeightAvgKg: z.number().positive().nullable().optional(),
  ownerCompanyName: z.string().nullable().optional(),
  ownerCompanyAddress: z.string().nullable().optional(),
  ownerCompanyCui: z.string().nullable().optional(),
});

export const updateMachineSchema = z
  .object({
    machineType: machineTypeSchema,
    registrationPlate: z.string().min(1),
    internalCode: z.string().min(1),
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    fuelType: fuelTypeSchema,
    tankCapacityLiters: z.number().nonnegative(),
    farmtrackDeviceId: z.string().nullable(),
    currentHourmeterHrs: z.number().nonnegative(),
    isActive: z.boolean(),
    maxBaleCount: z.number().int().positive().nullable(),
    tareWeightKg: z.number().nonnegative().nullable(),
    baleWeightAvgKg: z.number().positive().nullable(),
    ownerCompanyName: z.string().nullable(),
    ownerCompanyAddress: z.string().nullable(),
    ownerCompanyCui: z.string().nullable(),
  })
  .partial();

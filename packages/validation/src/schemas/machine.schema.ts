import { z } from "zod";
import { MachineType, FuelType } from "@strawboss/types";
import { uuidSchema } from "../helpers/uuid.js";
import { timestampsSchema } from "../helpers/common.js";
import { softDeleteSchema } from "../helpers/common.js";

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
    currentOdometerKm: z.number().nonnegative(),
    currentHourmeterHrs: z.number().nonnegative(),
    isActive: z.boolean(),
    maxPayloadKg: z.number().positive().nullable(),
    maxBaleCount: z.number().int().positive().nullable(),
    tareWeightKg: z.number().nonnegative().nullable(),
    balesPerHourAvg: z.number().positive().nullable(),
    baleWeightAvgKg: z.number().positive().nullable(),
    reachMeters: z.number().positive().nullable(),
  })
  .merge(timestampsSchema)
  .merge(softDeleteSchema);

export const createMachineSchema = z.object({
  machineType: machineTypeSchema,
  registrationPlate: z.string().min(1).optional(),
  internalCode: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  fuelType: fuelTypeSchema,
  tankCapacityLiters: z.number().nonnegative(),
  farmtrackDeviceId: z.string().nullable().optional(),
  currentOdometerKm: z.number().nonnegative().optional(),
  currentHourmeterHrs: z.number().nonnegative().optional(),
  maxPayloadKg: z.number().positive().nullable().optional(),
  maxBaleCount: z.number().int().positive().nullable().optional(),
  tareWeightKg: z.number().nonnegative().nullable().optional(),
  balesPerHourAvg: z.number().positive().nullable().optional(),
  baleWeightAvgKg: z.number().positive().nullable().optional(),
  reachMeters: z.number().positive().nullable().optional(),
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
    currentOdometerKm: z.number().nonnegative(),
    currentHourmeterHrs: z.number().nonnegative(),
    isActive: z.boolean(),
    maxPayloadKg: z.number().positive().nullable(),
    maxBaleCount: z.number().int().positive().nullable(),
    tareWeightKg: z.number().nonnegative().nullable(),
    balesPerHourAvg: z.number().positive().nullable(),
    baleWeightAvgKg: z.number().positive().nullable(),
    reachMeters: z.number().positive().nullable(),
  })
  .partial();

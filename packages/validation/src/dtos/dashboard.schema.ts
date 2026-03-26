import { z } from "zod";
import { alertSchema } from "../schemas/alert.schema.js";

export const dashboardOverviewSchema = z.object({
  activeTrips: z.number().int().nonnegative(),
  balesToday: z.number().int().nonnegative(),
  activeMachines: z.number().int().nonnegative(),
  pendingAlerts: z.number().int().nonnegative(),
  tripsToday: z.number().int().nonnegative(),
  tripsCompleted: z.number().int().nonnegative(),
});

export const productionReportSchema = z.object({
  parcelId: z.string().uuid(),
  parcelName: z.string(),
  produced: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  lossPercentage: z.number().nonnegative(),
});

export const costReportSchema = z.object({
  entityId: z.string().uuid(),
  entityName: z.string(),
  entityType: z.enum(["parcel", "machine"]),
  fuelCost: z.number().nonnegative(),
  consumableCost: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
});

export const antiFraudReportSchema = z.object({
  flaggedTrips: z.number().int().nonnegative(),
  odometerAnomalies: z.number().int().nonnegative(),
  fuelAnomalies: z.number().int().nonnegative(),
  timingAnomalies: z.number().int().nonnegative(),
  recentAlerts: z.array(alertSchema),
});

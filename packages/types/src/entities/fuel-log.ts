import type { Timestamps, SoftDelete } from "../common.js";
import type { FuelType } from "./machine.js";

export interface FuelLog extends Timestamps, SoftDelete {
  id: string;
  machineId: string;
  operatorId: string;
  parcelId: string | null;
  loggedAt: string;
  fuelType: FuelType;
  quantityLiters: number;
  unitPrice: number | null;
  totalCost: number | null;
  odometerKm: number | null;
  hourmeterHrs: number | null;
  isFullTank: boolean;
  receiptPhotoUrl: string | null;
  notes: string | null;
  clientId: string | null;
  syncVersion: number;
}

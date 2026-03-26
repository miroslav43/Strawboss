import type { Timestamps, SoftDelete } from "../common.js";

export enum MachineType {
  truck = "truck",
  loader = "loader",
  baler = "baler",
}

export enum FuelType {
  diesel = "diesel",
  gasoline = "gasoline",
  electric = "electric",
}

export interface Machine extends Timestamps, SoftDelete {
  id: string;
  machineType: MachineType;
  registrationPlate: string;
  internalCode: string;
  make: string;
  model: string;
  year: number;
  fuelType: FuelType;
  tankCapacityLiters: number;
  farmtrackDeviceId: string | null;
  currentOdometerKm: number;
  currentHourmeterHrs: number;
  isActive: boolean;
  maxPayloadKg: number | null;
  maxBaleCount: number | null;
  tareWeightKg: number | null;
  balesPerHourAvg: number | null;
  baleWeightAvgKg: number | null;
  reachMeters: number | null;
}

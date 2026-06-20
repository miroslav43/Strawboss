import type { Timestamps, SoftDelete } from '../common.js';

export enum MachineType {
  truck = 'truck',
  loader = 'loader',
  baler = 'baler',
}

export enum FuelType {
  diesel = 'diesel',
  gasoline = 'gasoline',
  electric = 'electric',
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
  currentHourmeterHrs: number;
  isActive: boolean;
  maxBaleCount: number | null;
  tareWeightKg: number | null;
  baleWeightAvgKg: number | null;
  ownerCompanyName: string | null;
  ownerCompanyAddress: string | null;
  ownerCompanyCui: string | null;
  /**
   * One-time auxiliary truck spun up from a confirmed external trip_request.
   * Has no linked driver user; shown with an "AUX" badge on the truck board and
   * auto-deactivated (isActive=false) once its trip completes.
   */
  isAuxiliary: boolean;
}

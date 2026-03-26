import type { Timestamps, SoftDelete } from "../common.js";

export interface BaleProduction extends Timestamps, SoftDelete {
  id: string;
  parcelId: string;
  balerId: string;
  operatorId: string;
  productionDate: string;
  baleCount: number;
  avgBaleWeightKg: number | null;
  startTime: string | null;
  endTime: string | null;
  farmtrackSessionId: string | null;
}

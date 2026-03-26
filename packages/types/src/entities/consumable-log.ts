import type { Timestamps, SoftDelete } from "../common.js";

export enum ConsumableType {
  twine = "twine",
  net_wrap = "net_wrap",
  silage_film = "silage_film",
  other = "other",
}

export interface ConsumableLog extends Timestamps, SoftDelete {
  id: string;
  machineId: string;
  operatorId: string;
  parcelId: string | null;
  consumableType: ConsumableType;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  totalCost: number | null;
  loggedAt: string;
}

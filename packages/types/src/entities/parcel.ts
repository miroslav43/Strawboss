import type { Timestamps, SoftDelete, GeoPoint } from "../common.js";

export enum ParcelStatus {
  active = "active",
  inactive = "inactive",
}

/** Field harvest / work phase (map + parcels table; synced from daily plan “done”). */
export enum HarvestStatus {
  planned = "planned",
  to_harvest = "to_harvest",
  harvesting = "harvesting",
  harvested = "harvested",
}

export interface Parcel extends Timestamps, SoftDelete {
  id: string;
  code: string;
  name: string;
  ownerName: string;
  ownerContact: string | null;
  areaHectares: number;
  boundary: string | null;
  centroid: GeoPoint | null;
  address: string;
  municipality: string;
  farmtrackGeofenceId: string | null;
  farmId: string | null;
  notes: string | null;
  isActive: boolean;
  harvestStatus: HarvestStatus;
}

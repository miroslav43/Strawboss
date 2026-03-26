import type { Timestamps, SoftDelete, GeoPoint } from "../common.js";

export enum ParcelStatus {
  active = "active",
  inactive = "inactive",
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
  notes: string | null;
  isActive: boolean;
}

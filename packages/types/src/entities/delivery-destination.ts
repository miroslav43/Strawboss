import type { Timestamps, SoftDelete, GeoPoint } from "../common.js";

export interface DeliveryDestination extends Timestamps, SoftDelete {
  id: string;
  code: string;
  name: string;
  address: string;
  coords: GeoPoint | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  boundary: string | null;
  isActive: boolean;
}

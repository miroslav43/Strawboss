import type { GeoPoint } from "../common.js";

export interface TripCreateDto {
  sourceParcelId: string;
  truckId: string;
  driverId: string;
  loaderId?: string;
  loaderOperatorId?: string;
  destinationName?: string;
  destinationAddress?: string;
  destinationCoords?: GeoPoint;
}

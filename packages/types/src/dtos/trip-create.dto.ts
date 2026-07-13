import type { GeoPoint } from '../common.js';

export interface TripCreateDto {
  sourceParcelId: string;
  truckId: string;
  driverId: string;
  loaderId?: string;
  loaderOperatorId?: string;
  /**
   * FK to the destination depot. Without it the trip is invisible to the depot
   * manager (their sync pull filters on trips.destination_id) and cannot be
   * depot-confirmed — the name/address below are only a display snapshot.
   */
  destinationId?: string;
  destinationName?: string;
  destinationAddress?: string;
  destinationCoords?: GeoPoint;
}

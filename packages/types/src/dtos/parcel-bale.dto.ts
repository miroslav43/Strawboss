/**
 * Admin manual override of a parcel's bale tallies. At least one of `produced`
 * or `loaded` must be set — each is the TARGET absolute total (the backend
 * records the signed delta needed to reach it).
 */
export interface OverrideBalesDto {
  produced?: number;
  loaded?: number;
  reason?: string;
}

/**
 * Transfer a parcel's produced bales directly into a depot. Creates a virtual
 * `completed` trip to the chosen destination so the bales count as loaded off
 * the field AND appear in the depot's inventory.
 */
export interface TransferToDepotDto {
  destinationId: string;
  baleCount: number;
}

import type { Trip } from '@strawboss/types';
import { EMPTY } from '@/lib/date';

/**
 * Display helpers shared by the trips table and the trip detail view.
 *
 * These exist because a trip has two shapes underneath one type. An own-fleet
 * trip carries `driverId` -> `driverName` and a source parcel; an auxiliary trip
 * carries `driverId = NULL` by construction (the external driver has no app
 * account, see migration 00054) and its driver lives in `externalDriverName`.
 * Reading only the own-fleet field is what left the Șofer column permanently
 * blank for every auxiliary trip.
 */

/** Driver name, falling back to the external (account-less) driver of an aux trip. */
export function driverLabel(trip: Trip): string {
  return trip.driverName?.trim() || trip.externalDriverName?.trim() || EMPTY;
}

/**
 * Pickup point. Migration 00073's CHECK is a disjunction, not an exclusive-or,
 * so a trip may legitimately carry both a source parcel and a source depot —
 * show both rather than silently picking one.
 *
 * `sourceDepotName` only reaches the client once the trips list JOINs
 * delivery_destinations; until then a depot-sourced trip falls back to EMPTY.
 */
export function sourceLabel(trip: Trip): string {
  const parcel = trip.sourceParcelName?.trim() || trip.sourceParcelCode?.trim();
  const depot = trip.sourceDepotName?.trim();
  if (parcel && depot) return `${parcel} · ${depot}`;
  return parcel || depot || EMPTY;
}

/** Truck registration plate, falling back to the internal code. */
export function truckLabel(trip: Trip): string {
  return trip.truckPlate?.trim() || trip.truckCode?.trim() || EMPTY;
}

/**
 * Bale count. A trip is INSERTed with `bale_count = 0`, so a planned trip that
 * has not been loaded yet is indistinguishable from one that genuinely carried
 * nothing — `loadingCompletedAt` is the honest predicate.
 */
export function baleLabel(trip: Trip): string {
  if (!trip.loadingCompletedAt) return EMPTY;
  const loaded = Number(trip.baleCount ?? 0);
  const delivered = trip.deliveredBaleCount;
  if (delivered != null && Number(delivered) !== loaded) return `${delivered}/${loaded}`;
  return String(loaded);
}

/** True when the delivered count is short of the loaded count (render it in red). */
export function hasBaleShortfall(trip: Trip): boolean {
  if (!trip.loadingCompletedAt || trip.deliveredBaleCount == null) return false;
  return Number(trip.deliveredBaleCount) !== Number(trip.baleCount ?? 0);
}

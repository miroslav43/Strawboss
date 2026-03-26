import type { GeoPoint } from "@strawboss/types";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate distance between two geographic points using the Haversine formula.
 * @returns Distance in kilometers
 */
export function calculateDistance(
  point1: GeoPoint,
  point2: GeoPoint,
): number {
  const dLat = toRadians(point2.lat - point1.lat);
  const dLon = toRadians(point2.lon - point1.lon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.lat)) *
      Math.cos(toRadians(point2.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Calculate total distance along a path of sequential geographic points.
 * @returns Total distance in kilometers
 */
export function calculateTotalDistance(points: GeoPoint[]): number {
  if (points.length < 2) {
    return 0;
  }

  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += calculateDistance(points[i - 1], points[i]);
  }

  return totalDistance;
}

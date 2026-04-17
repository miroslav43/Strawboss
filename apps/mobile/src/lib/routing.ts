import * as Linking from 'expo-linking';

export interface RouteResult {
  points: { lat: number; lon: number }[];
  distanceKm: number;
  durationMin: number;
}

/**
 * Calculate a driving route between two points using the public OSRM API.
 * Returns null if the request fails (e.g. offline or no route found).
 */
export async function calculateRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<RouteResult | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const route = data.routes[0];
    const coords: { lat: number; lon: number }[] =
      route.geometry.coordinates.map((c: [number, number]) => ({
        lat: c[1],
        lon: c[0],
      }));

    return {
      points: coords,
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
    };
  } catch {
    return null;
  }
}

/**
 * Open an external navigation app (Google Maps / default) with the destination.
 */
export function getExternalNavUrl(lat: number, lon: number): string {
  // google.navigation: works on Android with Google Maps installed
  // Falls back to geo: URI which opens any navigation app
  return `google.navigation:q=${lat},${lon}`;
}

export function getGeoUri(lat: number, lon: number): string {
  return `geo:${lat},${lon}?q=${lat},${lon}`;
}

export function getGoogleMapsWebDirUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

/**
 * Try to open turn-by-turn navigation: Google Maps (Android) → geo: → web Maps.
 * The first URL that opens successfully wins; some schemes don't report via canOpenURL.
 */
export async function openExternalNavigation(lat: number, lon: number): Promise<void> {
  const candidates = [getExternalNavUrl(lat, lon), getGeoUri(lat, lon), getGoogleMapsWebDirUrl(lat, lon)];
  let lastError: unknown;
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Nu s-a putut deschide navigația');
}

/** Rough straight-line distance in km (for UI when OSRM is unavailable). */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

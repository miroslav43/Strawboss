/**
 * No-key OSM helpers for the confirmation-email route map + distance.
 *
 * - Driving distance + route geometry from the public OSRM demo server.
 * - A static PNG (openstreetmap.de) with pickup/delivery markers + the route path.
 *
 * Everything is best-effort: on any failure we fall back to a straight-line
 * (haversine) distance and a straight geometry, so the email is still valid
 * (the Google Maps links always work regardless).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteResult {
  distanceKm: number;
  /** Sampled route points for drawing; at least [from, to]. */
  points: LatLon[];
  /** true when the distance came from OSRM (driving), false = straight-line estimate. */
  routed: boolean;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Decode a Google/OSRM encoded polyline (precision 5) to lat/lon points. */
function decodePolyline(str: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0,
    lat = 0,
    lon = 0;
  while (index < str.length) {
    let result = 0,
      shift = 0,
      b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}

function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** OSRM driving route; falls back to a straight line on any failure. */
export async function buildRoute(osrmBase: string, from: LatLon, to: LatLon): Promise<RouteResult> {
  const fallback: RouteResult = {
    distanceKm: haversineKm(from, to),
    points: [from, to],
    routed: false,
  };
  try {
    const url =
      `${osrmBase.replace(/\/$/, '')}/route/v1/driving/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      routes?: { distance?: number; geometry?: string }[];
    };
    const route = json.routes?.[0];
    if (!route || route.distance == null || !route.geometry) return fallback;
    const points = sample(decodePolyline(route.geometry), 40);
    return {
      distanceKm: route.distance / 1000,
      points: points.length >= 2 ? points : [from, to],
      routed: true,
    };
  } catch {
    return fallback;
  }
}

/** Zoom that roughly fits both endpoints in a ~600×300 image. */
function fitZoom(from: LatLon, to: LatLon): number {
  const span = Math.max(Math.abs(from.lat - to.lat), Math.abs(from.lon - to.lon) * 0.7);
  if (span > 4) return 6;
  if (span > 2) return 7;
  if (span > 1) return 8;
  if (span > 0.5) return 9;
  if (span > 0.25) return 10;
  if (span > 0.12) return 11;
  if (span > 0.06) return 12;
  if (span > 0.03) return 13;
  return 14;
}

/**
 * openstreetmap.de static map: green pickup + red delivery markers and the route
 * path. Unknown params are ignored by the renderer, so if `path` is unsupported
 * the markers still render. Returns null if inputs are missing.
 */
export function staticMapUrl(base: string, from: LatLon, to: LatLon, points: LatLon[]): string {
  const center = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
  const markers = [`${from.lat},${from.lon},lightgreen`, `${to.lat},${to.lon},red`].join('|');
  const path = sample(points, 30)
    .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
    .join('|');
  const params = new URLSearchParams({
    center: `${center.lat.toFixed(5)},${center.lon.toFixed(5)}`,
    zoom: String(fitZoom(from, to)),
    size: '600x300',
    maptype: 'mapnik',
    markers,
    path: `color:0x1d4ed8|weight:4|${path}`,
  });
  return `${base}?${params.toString()}`;
}

/**
 * No-key OSM helpers for the confirmation-email route map + distance.
 *
 * - Driving distance + route geometry from the public OSRM demo server.
 * - A static PNG (Yandex, no key, Latin labels) with pickup/delivery markers + route line.
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
 * Yandex static map (no key): green pickup + red delivery markers and the blue route
 * polyline. `lang=en_US` forces Latin (not Cyrillic) place labels. Coordinates are
 * lon,lat order. Replaces the openstreetmap.de renderer, which was discontinued (its
 * host no longer resolves, so those emails shipped a broken map image). The query is
 * built by hand so the `,` `~` `:` separators stay literal (Yandex requires them raw).
 */
export function staticMapUrl(base: string, from: LatLon, to: LatLon, points: LatLon[]): string {
  const center = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
  const pt = `${from.lon},${from.lat},pm2gnm~${to.lon},${to.lat},pm2rdm`;
  const line = sample(points, 30)
    .map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`)
    .join(',');
  const q =
    `ll=${center.lon.toFixed(5)},${center.lat.toFixed(5)}` +
    `&z=${fitZoom(from, to)}` +
    `&size=600,300&l=map&lang=en_US` +
    `&pt=${pt}` +
    `&pl=c:1d4ed8ff,w:4,${line}`;
  return `${base.replace(/\/$/, '')}/?${q}`;
}

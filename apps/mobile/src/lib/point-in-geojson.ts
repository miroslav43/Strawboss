/**
 * Point-in-polygon for GeoJSON Polygon / MultiPolygon (WGS84 lon/lat).
 * Holes in Polygon: point must be inside the exterior ring and outside all holes.
 */

type Ring = [number, number][];

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (Math.abs(yj - yi) < 1e-12) continue;
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** One GeoJSON Polygon: first ring = exterior, rest = holes. */
function pointInPolygonCoords(lon: number, lat: number, coordinates: Ring[]): boolean {
  if (!coordinates.length) return false;
  const exterior = coordinates[0];
  if (!pointInRing(lon, lat, exterior)) return false;
  for (let h = 1; h < coordinates.length; h++) {
    if (pointInRing(lon, lat, coordinates[h])) return false;
  }
  return true;
}

function pointInMultiPolygon(lon: number, lat: number, coordinates: Ring[][]): boolean {
  for (const polygon of coordinates) {
    if (pointInPolygonCoords(lon, lat, polygon)) return true;
  }
  return false;
}

function asGeometry(raw: unknown): { type: string; coordinates: unknown } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asGeometry(parsed);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon' && type !== 'Feature') {
    return null;
  }
  if (type === 'Feature') {
    return asGeometry(o.geometry);
  }
  if (type === 'Polygon' && Array.isArray(o.coordinates)) {
    return { type: 'Polygon', coordinates: o.coordinates };
  }
  if (type === 'MultiPolygon' && Array.isArray(o.coordinates)) {
    return { type: 'MultiPolygon', coordinates: o.coordinates };
  }
  return null;
}

/**
 * Returns true if (lon, lat) lies inside the GeoJSON geometry (Polygon or MultiPolygon).
 */
export function pointInBoundary(lon: number, lat: number, boundaryJson: unknown): boolean {
  const g = asGeometry(boundaryJson);
  if (!g) return false;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    return pointInPolygonCoords(lon, lat, g.coordinates as Ring[]);
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return pointInMultiPolygon(lon, lat, g.coordinates as Ring[][]);
  }
  return false;
}

export interface ParcelLikeForHitTest {
  boundary: unknown;
  areaHectares: number;
  name: string;
}

/**
 * Parcels that contain (lon, lat); if several overlap, pick smallest areaHectares,
 * then stable tie-break by name (documented product rule).
 */
export function pickSmallestContainingParcel<T extends ParcelLikeForHitTest>(
  lon: number,
  lat: number,
  parcels: T[],
): T | null {
  const hits = parcels.filter(
    (p) =>
      p.boundary != null &&
      p.boundary !== '' &&
      pointInBoundary(lon, lat, p.boundary),
  );
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const sorted = [...hits].sort((a, b) => {
    const da = Number(a.areaHectares) - Number(b.areaHectares);
    if (da !== 0) return da;
    return a.name.localeCompare(b.name);
  });
  return sorted[0] ?? null;
}

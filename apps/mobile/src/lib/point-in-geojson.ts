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
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
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

/**
 * Default GPS-tolerance (metres) for "am I on this field" matching. Mirrors the
 * server geofence enter buffer — phone GPS drifts 5–20 m and operators work at
 * field edges, so strict containment misses constantly.
 */
export const PARCEL_MATCH_TOLERANCE_M = 30;

const M_PER_DEG_LAT = 111_320;
const metersPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Distance (m) from point (lon,lat) to segment A→B in a local equirectangular plane. */
function pointToSegmentMeters(
  lon: number,
  lat: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const mLon = metersPerDegLon(lat);
  const px = (lon - ax) * mLon;
  const py = (lat - ay) * M_PER_DEG_LAT;
  const dx = (bx - ax) * mLon;
  const dy = (by - ay) * M_PER_DEG_LAT;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * dx, py - t * dy);
}

function ringMinEdgeMeters(lon: number, lat: number, ring: Ring): number {
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = pointToSegmentMeters(lon, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d < min) min = d;
  }
  return min;
}

/** Metres from (lon,lat) to the geometry boundary; 0 when strictly inside. */
export function distanceToBoundaryMeters(lon: number, lat: number, boundaryJson: unknown): number {
  if (pointInBoundary(lon, lat, boundaryJson)) return 0;
  const g = asGeometry(boundaryJson);
  if (!g) return Infinity;
  const polys: Ring[][] =
    g.type === 'Polygon' ? [g.coordinates as Ring[]] : (g.coordinates as Ring[][]);
  let min = Infinity;
  for (const poly of polys) {
    const exterior = poly[0];
    if (Array.isArray(exterior)) {
      const d = ringMinEdgeMeters(lon, lat, exterior);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Rough centroid (average of exterior-ring vertices) of a Polygon/MultiPolygon.
 * Good enough to drop a navigation pin when a feature has a boundary but no
 * stored point (delivery destinations store only a boundary). Returns null when
 * the geometry can't be parsed.
 */
export function boundaryCentroidLonLat(boundaryJson: unknown): { lat: number; lon: number } | null {
  const g = asGeometry(boundaryJson);
  if (!g) return null;
  const polys: Ring[][] =
    g.type === 'Polygon' ? [g.coordinates as Ring[]] : (g.coordinates as Ring[][]);
  let sumLon = 0;
  let sumLat = 0;
  let n = 0;
  for (const poly of polys) {
    const ring = poly[0];
    if (!Array.isArray(ring) || ring.length === 0) continue;
    // Drop the closing vertex (duplicate of the first) so it isn't double-weighted.
    const first = ring[0];
    const last = ring[ring.length - 1];
    const len =
      ring.length > 1 && first[0] === last[0] && first[1] === last[1]
        ? ring.length - 1
        : ring.length;
    for (let i = 0; i < len; i++) {
      sumLon += ring[i][0];
      sumLat += ring[i][1];
      n++;
    }
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lon: sumLon / n };
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
  toleranceM = 0,
): T | null {
  const valid = parcels.filter((p) => p.boundary != null && p.boundary !== '');
  const hits = valid.filter((p) => pointInBoundary(lon, lat, p.boundary));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const sorted = [...hits].sort((a, b) => {
      const da = Number(a.areaHectares) - Number(b.areaHectares);
      if (da !== 0) return da;
      return a.name.localeCompare(b.name);
    });
    return sorted[0] ?? null;
  }
  // No strict containment — fall back to the nearest parcel within tolerance so
  // an operator at the field edge / under GPS drift still matches the field.
  if (toleranceM > 0) {
    let best: T | null = null;
    let bestDist = Infinity;
    for (const p of valid) {
      const d = distanceToBoundaryMeters(lon, lat, p.boundary);
      if (d <= toleranceM && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }
  return null;
}

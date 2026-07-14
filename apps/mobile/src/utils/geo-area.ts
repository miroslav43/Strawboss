/**
 * Geodesic area of a GeoJSON polygon, in hectares.
 *
 * The server is the authority — `parcels.area_hectares` is computed by PostGIS
 * from the stored geometry. But a freshly drawn field sits in the local cache for
 * as long as it takes the sync queue to reach the server, and a field card reading
 * "— ha" for that whole window is a worse lie than a number that is right to three
 * decimals. So we compute it on the phone for the interim; the server's value
 * overwrites ours on the next refresh.
 *
 * ## Why the authalic latitude, and not just a sphere
 *
 * The obvious implementation — spherical excess on the mean Earth radius — is off
 * by ~0.25% at Romanian latitudes (0.2 ha on an 86 ha field), which is enough for
 * the phone and the web dashboard to visibly disagree. The mean radius preserves
 * the Earth's TOTAL area, not the local area of any given patch.
 *
 * The fix is the authalic (equal-area) latitude: the map from the WGS-84 ellipsoid
 * onto a sphere of radius Rq that preserves area exactly. Substituting it into the
 * same spherical formula brings the error to ~0.009% — i.e. it agrees with
 * PostGIS `ST_Area(geography)` to well past any digit we display.
 */

/** WGS-84 semi-major axis, metres. */
const WGS84_A = 6378137.0;
/** WGS-84 first eccentricity squared. */
const WGS84_E2 = 0.00669437999014;
const WGS84_E = Math.sqrt(WGS84_E2);

const DEG_TO_RAD = Math.PI / 180;

/** Authalic ("equal-area") auxiliary quantity q(φ). */
function authalicQ(latRad: number): number {
  const s = Math.sin(latRad);
  return (
    (1 - WGS84_E2) *
    (s / (1 - WGS84_E2 * s * s) -
      (1 / (2 * WGS84_E)) * Math.log((1 - WGS84_E * s) / (1 + WGS84_E * s)))
  );
}

const Q_POLE = authalicQ(Math.PI / 2);
/** Radius of the sphere with the same surface area as the WGS-84 ellipsoid. */
const AUTHALIC_RADIUS_M = WGS84_A * Math.sqrt(Q_POLE / 2);

/** sin of the authalic latitude — the only form the area sum needs. */
function sinAuthalic(latDeg: number): number {
  const ratio = authalicQ(latDeg * DEG_TO_RAD) / Q_POLE;
  return Math.max(-1, Math.min(1, ratio));
}

type Ring = [number, number][];

/** Signed area of one closed ring, in square metres. */
function ringAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 * DEG_TO_RAD - lon1 * DEG_TO_RAD) * (2 + sinAuthalic(lat1) + sinAuthalic(lat2));
  }
  return (total * AUTHALIC_RADIUS_M * AUTHALIC_RADIUS_M) / 2;
}

function isRing(value: unknown): value is Ring {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number',
    )
  );
}

/**
 * Area in hectares of a GeoJSON `Polygon` or `MultiPolygon`, or null if the
 * geometry is not one we can measure.
 *
 * Ring 0 is the exterior; its magnitude is taken, because a hand-drawn polygon
 * carries no winding-order guarantee. Any further rings are holes and subtract.
 */
export function polygonAreaHectares(geojson: unknown): number | null {
  if (!geojson || typeof geojson !== 'object') return null;
  const geom = geojson as { type?: unknown; coordinates?: unknown };

  let polygons: unknown[];
  if (geom.type === 'Polygon') {
    polygons = [geom.coordinates];
  } else if (geom.type === 'MultiPolygon') {
    if (!Array.isArray(geom.coordinates)) return null;
    polygons = geom.coordinates;
  } else {
    return null;
  }

  let m2 = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    for (let r = 0; r < polygon.length; r++) {
      const ring: unknown = polygon[r];
      if (!isRing(ring)) continue;
      const magnitude = Math.abs(ringAreaM2(ring));
      m2 += r === 0 ? magnitude : -magnitude;
    }
  }

  if (!Number.isFinite(m2) || m2 <= 0) return null;
  return m2 / 10_000;
}

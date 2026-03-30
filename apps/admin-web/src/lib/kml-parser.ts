export interface KmlParsedParcel {
  name: string;
  municipality: string;
  previewHa: number | null;
  boundary: GeoJSON.Geometry;
}

/** Parse a KML text string and return all Placemarks that contain a Polygon. */
export function parseKml(text: string): KmlParsedParcel[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`KML parse error: ${parseError.textContent?.slice(0, 200)}`);
  }

  const placemarks = Array.from(doc.querySelectorAll('Placemark'));
  const results: KmlParsedParcel[] = [];

  for (const pm of placemarks) {
    const polygons = pm.querySelectorAll('Polygon');
    if (polygons.length === 0) continue;

    const placeName = pm.querySelector(':scope > name')?.textContent?.trim() ?? '';
    const description = pm.querySelector(':scope > description')?.textContent?.trim() ?? '';
    const previewHa = description ? parseFloat(description) : null;

    const commune = getSimpleData(pm, 'commune');
    const cropName = getSimpleData(pm, 'crop_name');

    const name = [placeName, cropName].filter(Boolean).join(' - ') || placeName;
    const municipality = commune ?? '';

    const boundary = buildGeometry(polygons);
    if (!boundary) continue;

    results.push({
      name,
      municipality,
      previewHa: previewHa !== null && !isNaN(previewHa) ? Math.round(previewHa * 100) / 100 : null,
      boundary,
    });
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSimpleData(pm: Element, fieldName: string): string | null {
  const nodes = pm.querySelectorAll(`SimpleData[name="${fieldName}"]`);
  for (const node of nodes) {
    const val = node.textContent?.trim();
    if (val) return val;
  }
  return null;
}

/**
 * Build a GeoJSON Polygon or MultiPolygon from a NodeList of KML <Polygon> elements.
 * Each <Polygon> has one outerBoundaryIs and zero or more innerBoundaryIs (holes).
 */
function buildGeometry(polygons: NodeListOf<Element>): GeoJSON.Geometry | null {
  const rings: GeoJSON.Position[][][] = [];

  for (const polygon of polygons) {
    const outer = parseRing(polygon.querySelector('outerBoundaryIs LinearRing coordinates'));
    if (!outer) continue;

    const holes: GeoJSON.Position[][] = [];
    const innerBoundaries = polygon.querySelectorAll('innerBoundaryIs LinearRing coordinates');
    for (const inner of innerBoundaries) {
      const hole = parseRing(inner);
      if (hole) holes.push(hole);
    }

    rings.push([outer, ...holes]);
  }

  if (rings.length === 0) return null;
  if (rings.length === 1) return { type: 'Polygon', coordinates: rings[0] };
  return { type: 'MultiPolygon', coordinates: rings };
}

/**
 * Parse a KML <coordinates> element.
 * KML format: "lon,lat[,alt] lon,lat[,alt] ..."
 * GeoJSON format: [[lon, lat], ...]
 */
function parseRing(coordsEl: Element | null): GeoJSON.Position[] | null {
  if (!coordsEl) return null;
  const raw = coordsEl.textContent?.trim() ?? '';
  if (!raw) return null;

  const positions: GeoJSON.Position[] = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const parts = token.split(',').map(Number);
      if (parts.length < 2 || parts.some(isNaN)) return null;
      return [parts[0], parts[1]] as GeoJSON.Position;
    })
    .filter((p): p is GeoJSON.Position => p !== null);

  if (positions.length < 3) return null;

  // Ensure ring is closed (first === last)
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    positions.push([first[0], first[1]]);
  }

  return positions;
}

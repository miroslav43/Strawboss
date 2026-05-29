export interface KmlParsedParcel {
  /**
   * Stable code from the Placemark `<name>` (e.g. "RO010502500 - 1a"). Used as
   * the parcel code for upsert-by-conflict. Null when the Placemark is unnamed.
   */
  code: string | null;
  /** Display name — the code, or "<name> - <crop_name>" for the old dialect. */
  name: string;
  municipality: string;
  /** Raw crop / land-use string from `desc` / `crop_name` (e.g. "PORUMB"). */
  cropRaw: string | null;
  /** Campaign year from `src` (e.g. "2025"). */
  year: string | null;
  /** Declared area in hectares from `cmt` / `<description>`; null if absent. */
  declaredHa: number | null;
  /** Same as `declaredHa`; kept for the preview list label. */
  previewHa: number | null;
  boundary: GeoJSON.Geometry;
}

/** Minimal DOMParser surface — lets us inject `@xmldom/xmldom` in Node for tests. */
export interface DomParserLike {
  parseFromString(text: string, mimeType: string): Document;
}

/**
 * Parse a KML text string into parcels. Handles two dialects:
 *  - the classic KML `<Polygon>` (with `commune` / `crop_name` / `<description>`), and
 *  - the GDAL/ogr2ogr "tracks" export, where each parcel is a closed
 *    `<LineString>` ring with `cmt` (area ha) / `desc` (crop) / `src` (year).
 *
 * Uses only portable DOM APIs (`getElementsByTagName`, `getAttribute`,
 * `textContent`) so the same code runs in the browser and under `@xmldom/xmldom`.
 */
export function parseKml(text: string, domParser?: DomParserLike): KmlParsedParcel[] {
  const parser: DomParserLike = domParser ?? new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  // Browsers surface XML parse failures as a <parsererror> node.
  const parseErrors = doc.getElementsByTagName('parsererror');
  if (parseErrors.length > 0) {
    throw new Error(`KML parse error: ${parseErrors[0].textContent?.slice(0, 200) ?? ''}`);
  }

  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const results: KmlParsedParcel[] = [];

  for (const pm of placemarks) {
    const boundary = buildGeometry(pm);
    if (!boundary) continue;

    const placeName = directChildText(pm, 'name');
    const description = directChildText(pm, 'description');

    // New "tracks" dialect first, classic dialect as fallback.
    const cropName = getSimpleData(pm, 'crop_name');
    const cropRaw = getSimpleData(pm, 'desc') ?? cropName;
    const year = getSimpleData(pm, 'src');
    const commune = getSimpleData(pm, 'commune');
    const declaredHa = parseArea(getSimpleData(pm, 'cmt')) ?? parseArea(description);

    // Classic dialect joined "<name> - <crop_name>"; tracks dialect is just the code.
    const name = [placeName, cropName].filter(Boolean).join(' - ') || placeName;

    results.push({
      code: placeName || null,
      name,
      municipality: commune ?? '',
      cropRaw: cropRaw ?? null,
      year: year ?? null,
      declaredHa,
      previewHa: declaredHa,
      boundary,
    });
  }

  return results;
}

// ── Geometry ───────────────────────────────────────────────────────────────

/** Build a GeoJSON geometry from a Placemark, preferring <Polygon> over <LineString>. */
function buildGeometry(pm: Element): GeoJSON.Geometry | null {
  const polygons = pm.getElementsByTagName('Polygon');
  if (polygons.length > 0) return buildFromPolygons(polygons);

  const lineStrings = pm.getElementsByTagName('LineString');
  if (lineStrings.length > 0) return buildFromLineStrings(lineStrings);

  return null;
}

/**
 * Classic KML: each <Polygon> has one outerBoundaryIs and zero or more
 * innerBoundaryIs (holes). One polygon → Polygon, many → MultiPolygon.
 */
function buildFromPolygons(polygons: ArrayLike<Element>): GeoJSON.Geometry | null {
  const rings: GeoJSON.Position[][][] = [];

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    const outerEls = polygon.getElementsByTagName('outerBoundaryIs');
    const outer = parseRing(outerEls.length ? coordsTextWithin(outerEls[0]) : null);
    if (!outer) continue;

    const holes: GeoJSON.Position[][] = [];
    const innerEls = polygon.getElementsByTagName('innerBoundaryIs');
    for (let j = 0; j < innerEls.length; j++) {
      const hole = parseRing(coordsTextWithin(innerEls[j]));
      if (hole) holes.push(hole);
    }

    rings.push([outer, ...holes]);
  }

  if (rings.length === 0) return null;
  if (rings.length === 1) return { type: 'Polygon', coordinates: rings[0] };
  return { type: 'MultiPolygon', coordinates: rings };
}

/**
 * "tracks" dialect: parcels are closed <LineString> rings. One ring → Polygon,
 * several rings under one Placemark → MultiPolygon (each ring its own polygon).
 */
function buildFromLineStrings(lineStrings: ArrayLike<Element>): GeoJSON.Geometry | null {
  const rings: GeoJSON.Position[][] = [];

  for (let i = 0; i < lineStrings.length; i++) {
    const coordsEls = lineStrings[i].getElementsByTagName('coordinates');
    if (!coordsEls.length) continue;
    const ring = parseRing(coordsEls[0].textContent ?? null);
    if (ring) rings.push(ring);
  }

  if (rings.length === 0) return null;
  if (rings.length === 1) return { type: 'Polygon', coordinates: [rings[0]] };
  return { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Trimmed text of a Placemark's direct-child element (e.g. its own <name>). */
function directChildText(el: Element, tag: string): string {
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    // 1 === Node.ELEMENT_NODE
    if (node.nodeType !== 1) continue;
    const elNode = node as Element;
    if ((elNode.localName ?? elNode.nodeName) === tag) {
      return (elNode.textContent ?? '').trim();
    }
  }
  return '';
}

/** First non-empty <SimpleData name="fieldName"> value inside a Placemark. */
function getSimpleData(pm: Element, fieldName: string): string | null {
  const nodes = pm.getElementsByTagName('SimpleData');
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('name') === fieldName) {
      const val = (nodes[i].textContent ?? '').trim();
      if (val) return val;
    }
  }
  return null;
}

/** Text of the first <coordinates> descendant of an element. */
function coordsTextWithin(el: Element): string | null {
  const c = el.getElementsByTagName('coordinates');
  return c.length ? (c[0].textContent ?? '') : null;
}

/** Parse a hectare value, rounded to 2 decimals; null if absent/unparseable. */
function parseArea(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Parse a KML <coordinates> string ("lon,lat[,alt] lon,lat[,alt] …") into a
 * closed GeoJSON linear ring ([[lon, lat], …]). Returns null if it has fewer
 * than 3 points.
 */
function parseRing(raw: string | null): GeoJSON.Position[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const positions: GeoJSON.Position[] = trimmed
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

  // Ensure the ring is closed (first === last).
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    positions.push([first[0], first[1]]);
  }

  return positions;
}

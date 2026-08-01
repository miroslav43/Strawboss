/** Typed message protocol between React Native and the Leaflet WebView map. */

// ── Commands: React Native → WebView ─────────────────────────────────

export interface ParcelMapData {
  id: string;
  name: string | null;
  code: string;
  harvestStatus: string;
  areaHectares: number;
  boundary: unknown; // GeoJSON Polygon or string
}

export interface DestinationMapData {
  id: string;
  name: string;
  code: string;
  boundary: unknown | null; // GeoJSON Polygon or string, may be null
  lat?: number;
  lon?: number;
}

export interface MachineMarkerData {
  id: string;
  machineCode: string;
  machineType: string; // 'truck' | 'loader' | 'baler'
  lat: number;
  lon: number;
  operatorName: string | null;
  /** Full tooltip line from RN (e.g. includes ≈km). If omitted, WebView builds from code + operator. */
  tooltipLabel?: string;
}

export type MapCommand =
  | { type: 'SET_PARCELS'; parcels: ParcelMapData[] }
  | { type: 'SET_DESTINATIONS'; destinations: DestinationMapData[] }
  | { type: 'SET_MACHINES'; machines: MachineMarkerData[] }
  | { type: 'SET_USER_LOCATION'; lat: number; lon: number; accuracy?: number }
  | {
      type: 'SET_ROUTE';
      points: { lat: number; lon: number }[];
      distanceKm?: number;
      durationMin?: number;
    }
  | { type: 'CLEAR_ROUTE' }
  | { type: 'HIGHLIGHT_PARCEL'; parcelId: string }
  // Style-only: paints the given parcel ids purple ("assigned to me today").
  // Deliberately NOT a field on ParcelMapData/SET_PARCELS — see the doc
  // comment on setAssignedParcels() in leaflet-map-content.ts for why.
  | { type: 'SET_ASSIGNED_PARCELS'; parcelIds: string[] }
  | { type: 'FIT_BOUNDS' }
  | { type: 'CENTER_ON'; lat: number; lon: number; zoom?: number };

// ── Events: WebView → React Native ──────────────────────────────────

export type MapEvent =
  | { type: 'PARCEL_TAPPED'; parcelId: string; parcelName: string }
  | { type: 'DESTINATION_TAPPED'; destinationId: string; destinationName: string }
  | { type: 'MAP_READY' };

/** Serialize a command to inject into the WebView. */
export function serializeCommand(cmd: MapCommand): string {
  return `window.handleCommand(${JSON.stringify(cmd)});`;
}

/** Parse a WebView postMessage string into a typed MapEvent (or null). */
export function parseEvent(data: string): MapEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as MapEvent;
    }
  } catch {
    // Ignore non-JSON messages (e.g. console logs from WebView)
  }
  return null;
}

// ── Geofence Editor (geofence_maker role) ────────────────────────────

export type GeofenceEditorCommand =
  | { type: 'SET_PARCELS'; parcels: ParcelMapData[] }
  | { type: 'SET_DESTINATIONS'; destinations: DestinationMapData[] }
  | { type: 'FIT_BOUNDS' }
  | { type: 'SET_USER_LOCATION'; lat: number; lon: number; accuracy?: number }
  | { type: 'ENABLE_DRAW' }
  | { type: 'DISABLE_DRAW' }
  // CLEAR_DRAWN wipes the in-progress polygon (drawnItems + preview) from the
  // map without persisting it — used when the create modal is cancelled so the
  // geofence only survives an explicit Save.
  | { type: 'CLEAR_DRAWN' }
  | { type: 'HIGHLIGHT_PARCEL'; parcelId: string }
  | { type: 'CENTER_ON'; lat: number; lon: number; zoom?: number }
  // T1 — center-pin point picker. ENABLE_POINT_DRAW shows a fixed round pin
  // in the centre of the WebView; the user pans the map underneath it.
  // GET_CENTER asks the WebView to emit POINT_DRAWN with the current centre.
  | { type: 'ENABLE_POINT_DRAW' }
  | { type: 'DISABLE_POINT_DRAW' }
  | { type: 'GET_CENTER' }
  // T1 — polygon-by-points: center the map on each desired vertex, tap
  // ADD_VERTEX_AT_CENTER to push the centre into the in-progress polygon;
  // REMOVE_LAST_VERTEX undoes; FINISH_POLYGON emits POLYGON_DRAWN with the
  // closed ring. Use instead of `ENABLE_DRAW` for the Google-Earth-style flow.
  | { type: 'ADD_VERTEX_AT_CENTER' }
  | { type: 'REMOVE_LAST_VERTEX' }
  | { type: 'FINISH_POLYGON' };

export type GeofenceEditorEvent =
  | { type: 'MAP_READY' }
  | { type: 'POLYGON_DRAWN'; geojson: object }
  | { type: 'POINT_DRAWN'; lat: number; lon: number }
  // T1 — fired after ADD_VERTEX_AT_CENTER / REMOVE_LAST_VERTEX so RN can
  // refresh the counter / "Finalizează" button enabled state.
  | { type: 'VERTEX_COUNT'; count: number };

export function serializeEditorCommand(cmd: GeofenceEditorCommand): string {
  return `window.handleCommand(${JSON.stringify(cmd)});`;
}

export function parseGeofenceEditorEvent(data: string): GeofenceEditorEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === 'string') return parsed as GeofenceEditorEvent;
  } catch {
    // ignore non-JSON messages
  }
  return null;
}

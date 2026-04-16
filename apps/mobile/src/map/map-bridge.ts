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
}

export type MapCommand =
  | { type: 'SET_PARCELS'; parcels: ParcelMapData[] }
  | { type: 'SET_DESTINATIONS'; destinations: DestinationMapData[] }
  | { type: 'SET_MACHINES'; machines: MachineMarkerData[] }
  | { type: 'SET_USER_LOCATION'; lat: number; lon: number; accuracy?: number }
  | { type: 'SET_ROUTE'; points: { lat: number; lon: number }[]; distanceKm?: number; durationMin?: number }
  | { type: 'CLEAR_ROUTE' }
  | { type: 'HIGHLIGHT_PARCEL'; parcelId: string }
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

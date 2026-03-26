import type { GeoPoint } from '@strawboss/types';

/**
 * Pure functions to map FarmTrack event payloads to StrawBoss entities.
 */

export interface FarmTrackPositionEvent {
  event_type: 'position';
  device_id: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  heading: number;
  timestamp: string;
}

export interface FarmTrackGeofenceEvent {
  event_type: 'geofence_enter' | 'geofence_exit';
  device_id: string;
  geofence_id: string;
  geofence_name: string;
  lat: number;
  lon: number;
  timestamp: string;
}

export interface FarmTrackOdometerEvent {
  event_type: 'odometer';
  device_id: string;
  value_km: number;
  timestamp: string;
}

/**
 * Extract a GeoPoint from a FarmTrack position event.
 */
export function positionToGeoPoint(event: FarmTrackPositionEvent): GeoPoint {
  return { lat: event.lat, lon: event.lon };
}

/**
 * Map a FarmTrack position event to a machine position update payload.
 */
export function positionToMachineUpdate(event: FarmTrackPositionEvent): {
  lastKnownLat: number;
  lastKnownLon: number;
  lastPositionAt: string;
} {
  return {
    lastKnownLat: event.lat,
    lastKnownLon: event.lon,
    lastPositionAt: event.timestamp,
  };
}

/**
 * Map a FarmTrack odometer event to an odometer reading update.
 */
export function odometerToReading(event: FarmTrackOdometerEvent): {
  deviceId: string;
  odometerKm: number;
  readingAt: string;
} {
  return {
    deviceId: event.device_id,
    odometerKm: event.value_km,
    readingAt: event.timestamp,
  };
}

/**
 * Check if a raw payload looks like a position event.
 */
export function isPositionEvent(
  payload: Record<string, unknown>,
): boolean {
  return (
    payload.event_type === 'position' &&
    typeof payload.lat === 'number' &&
    typeof payload.lon === 'number'
  );
}

/**
 * Check if a raw payload looks like a geofence event.
 */
export function isGeofenceEvent(
  payload: Record<string, unknown>,
): boolean {
  return (
    payload.event_type === 'geofence_enter' ||
    payload.event_type === 'geofence_exit'
  );
}

/**
 * Check if a raw payload looks like an odometer event.
 */
export function isOdometerEvent(
  payload: Record<string, unknown>,
): boolean {
  return (
    payload.event_type === 'odometer' &&
    typeof payload.value_km === 'number'
  );
}

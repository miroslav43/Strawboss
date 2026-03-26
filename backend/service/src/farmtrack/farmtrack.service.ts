import { Injectable } from '@nestjs/common';
import type { GeoPoint } from '@strawboss/types';

export interface IFarmTrackService {
  getVehiclePosition(deviceId: string): Promise<GeoPoint | null>;
  getOdometerReading(deviceId: string): Promise<number | null>;
  getTripTrack(deviceId: string, start: Date, end: Date): Promise<GeoPoint[]>;
  getGeofenceEvents(since: Date): Promise<unknown[]>;
}

/**
 * Stub implementation of the FarmTrack integration service.
 * Returns mock data for development. Replace with real FarmTrack API
 * calls in production.
 */
@Injectable()
export class StubFarmTrackService implements IFarmTrackService {
  async getVehiclePosition(_deviceId: string): Promise<GeoPoint | null> {
    // Return a mock position (Novi Sad, Serbia area — agricultural region)
    return { lat: 45.2671, lon: 19.8335 };
  }

  async getOdometerReading(_deviceId: string): Promise<number | null> {
    // Return a mock odometer reading
    return Math.floor(50000 + Math.random() * 100000);
  }

  async getTripTrack(
    _deviceId: string,
    _start: Date,
    _end: Date,
  ): Promise<GeoPoint[]> {
    // Return a mock track with a few waypoints
    return [
      { lat: 45.2671, lon: 19.8335 },
      { lat: 45.28, lon: 19.85 },
      { lat: 45.3, lon: 19.87 },
      { lat: 45.32, lon: 19.9 },
    ];
  }

  async getGeofenceEvents(_since: Date): Promise<unknown[]> {
    // Return empty array — no mock geofence events
    return [];
  }
}

export const FARMTRACK_SERVICE = 'FARMTRACK_SERVICE';

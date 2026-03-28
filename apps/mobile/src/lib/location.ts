/**
 * GPS location utilities for StrawBoss mobile app.
 *
 * Each baler / loader / truck tablet runs this module to:
 *  1. Request device location permissions on first use.
 *  2. Get a one-shot current position.
 *  3. Start/stop a continuous location watcher that reports positions
 *     to the backend via POST /api/v1/location/report.
 *
 * Live tracking is NOT wired to the admin-web map yet — the backend
 * stores events which the admin can query at any time.
 */

import * as Location from 'expo-location';
import type { LocationReportDto } from '@strawboss/types';

export type { LocationSubscription } from 'expo-location';

/** Request foreground (and optionally background) location permissions. */
export async function requestLocationPermission(
  includeBackground = false,
): Promise<boolean> {
  const { status: fgStatus } =
    await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== Location.PermissionStatus.GRANTED) return false;

  if (includeBackground) {
    const { status: bgStatus } =
      await Location.requestBackgroundPermissionsAsync();
    return bgStatus === Location.PermissionStatus.GRANTED;
  }

  return true;
}

/**
 * Get the device's current GPS position.
 * Returns null if permissions are not granted or the position cannot be read.
 */
export async function getCurrentPosition(
  machineId: string,
): Promise<LocationReportDto | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      machineId,
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      accuracyM: loc.coords.accuracy ?? null,
      headingDeg: loc.coords.heading ?? null,
      speedMs: loc.coords.speed ?? null,
      recordedAt: new Date(loc.timestamp).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Start a continuous GPS watcher.
 *
 * @param machineId   UUID of the machine this device is assigned to.
 * @param onLocation  Callback invoked on each position update.
 * @returns           A `LocationSubscription` — pass to `stopLocationWatcher` to clean up.
 */
export async function startLocationWatcher(
  machineId: string,
  onLocation: (report: LocationReportDto) => void,
): Promise<Location.LocationSubscription | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;

  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 15_000,   // update every 15 s while app is active
      distanceInterval: 20,   // or every 20 m of movement
    },
    (loc) => {
      onLocation({
        machineId,
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        accuracyM: loc.coords.accuracy ?? null,
        headingDeg: loc.coords.heading ?? null,
        speedMs: loc.coords.speed ?? null,
        recordedAt: new Date(loc.timestamp).toISOString(),
      });
    },
  );
}

/** Stop an active location watcher returned by `startLocationWatcher`. */
export function stopLocationWatcher(
  sub: Location.LocationSubscription,
): void {
  sub.remove();
}

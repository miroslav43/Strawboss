/**
 * GPS location for StrawBoss mobile: foreground helpers + background updates
 * (TaskManager + foreground service on Android, UIBackgroundModes on iOS)
 * posting to POST /api/v1/location/report.
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiClient } from '@strawboss/api';
import type { LocationReportDto } from '@strawboss/types';
import { getAuthToken } from './auth';
import { mobileLogger } from './logger';

export type { LocationSubscription } from 'expo-location';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Task name for `Location.startLocationUpdatesAsync` / `hasStartedLocationUpdatesAsync`. */
export const LOCATION_UPDATES_TASK_NAME = 'strawboss-location-updates';

const doc = FileSystem.documentDirectory ?? '';
const MACHINE_ID_FILE = `${doc}strawboss-location-machine-id.txt`;
const PENDING_REPORTS_FILE = `${doc}strawboss-pending-location-reports.json`;
const LAST_SUCCESS_FILE = `${doc}strawboss-location-last-success.txt`;

const MAX_PENDING_REPORTS = 400;
const PENDING_REPORTS_WARN_THRESHOLD = Math.floor(MAX_PENDING_REPORTS * 0.9);

const locationApiClient = new ApiClient({
  baseUrl: API_BASE_URL,
  getToken: getAuthToken,
});

async function readMachineIdFromDisk(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(MACHINE_ID_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(MACHINE_ID_FILE);
    const id = raw.trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function writeMachineIdToDisk(machineId: string): Promise<void> {
  await FileSystem.writeAsStringAsync(MACHINE_ID_FILE, machineId);
}

async function clearMachineIdFile(): Promise<void> {
  await FileSystem.deleteAsync(MACHINE_ID_FILE, { idempotent: true });
}

async function readPendingReports(): Promise<LocationReportDto[]> {
  try {
    const info = await FileSystem.getInfoAsync(PENDING_REPORTS_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(PENDING_REPORTS_FILE);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as LocationReportDto[];
  } catch {
    return [];
  }
}

async function writePendingReports(reports: LocationReportDto[]): Promise<void> {
  if (reports.length >= PENDING_REPORTS_WARN_THRESHOLD) {
    mobileLogger.flow('Location pending queue near capacity — possible connectivity issue', {
      pendingCount: reports.length,
      maxAllowed: MAX_PENDING_REPORTS,
    });
  }
  const trimmed = reports.slice(-MAX_PENDING_REPORTS);
  await FileSystem.writeAsStringAsync(PENDING_REPORTS_FILE, JSON.stringify(trimmed));
}

async function appendPendingReport(report: LocationReportDto): Promise<void> {
  const cur = await readPendingReports();
  cur.push(report);
  await writePendingReports(cur);
}

async function writeLastSuccessTimestamp(): Promise<void> {
  await FileSystem.writeAsStringAsync(LAST_SUCCESS_FILE, new Date().toISOString());
}

/** Last successful location POST time (ISO string), for UI. */
export async function readLastLocationSuccessIso(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_SUCCESS_FILE);
    if (!info.exists) return null;
    const raw = (await FileSystem.readAsStringAsync(LAST_SUCCESS_FILE)).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function postLocationReport(report: LocationReportDto): Promise<void> {
  await locationApiClient.post<void>('/api/v1/location/report', report);
}

/** Retry outbox after failed background POSTs (e.g. offline / 401). */
export async function flushPendingLocationReports(): Promise<void> {
  const pending = await readPendingReports();
  if (pending.length === 0) return;

  const remaining: LocationReportDto[] = [];
  for (const report of pending) {
    try {
      await postLocationReport(report);
      await writeLastSuccessTimestamp();
    } catch {
      remaining.push(report);
    }
  }
  await writePendingReports(remaining);
}

/**
 * One-shot foreground GPS → server (or outbox on failure). Call when the app
 * becomes active so features like trucks-at-loader get a fresh loader ping
 * even if background task batches were interrupted.
 */
export async function postCurrentLocationNow(machineId: string): Promise<void> {
  const report = await getCurrentPosition(machineId);
  if (!report) return;
  try {
    await postLocationReport(report);
    await writeLastSuccessTimestamp();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mobileLogger.warn('Location report failed (foreground ping), queued for retry', {
      machineId,
      message: msg,
    });
    await appendPendingReport(report);
  }
}

function coordsToReport(machineId: string, loc: Location.LocationObject): LocationReportDto {
  return {
    machineId,
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    accuracyM: loc.coords.accuracy ?? null,
    headingDeg: loc.coords.heading ?? null,
    speedMs: loc.coords.speed ?? null,
    recordedAt: new Date(loc.timestamp).toISOString(),
  };
}

TaskManager.defineTask(LOCATION_UPDATES_TASK_NAME, async (taskBody) => {
  const { data, error } = taskBody;
  if (error) {
    mobileLogger.warn('Location background task error', {
      message:
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error),
    });
    return;
  }

  await flushPendingLocationReports();

  const machineId = await readMachineIdFromDisk();
  if (!machineId) {
    mobileLogger.debug('Location task: no machine id on disk, skipping batch');
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  for (const loc of locations) {
    const report = coordsToReport(machineId, loc);
    try {
      await postLocationReport(report);
      await writeLastSuccessTimestamp();
      mobileLogger.debug('Location report OK (background)', {
        machineId,
        lat: report.lat,
        lon: report.lon,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mobileLogger.warn('Location report failed (background), queued for retry', {
        machineId,
        message: msg,
      });
      await appendPendingReport(report);
    }
  }
});

/** Request foreground location; optionally background (required for Android background tracking). */
export async function requestLocationPermission(includeBackground = false): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== Location.PermissionStatus.GRANTED) return false;

  if (includeBackground && Platform.OS === 'android') {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    return bgStatus === Location.PermissionStatus.GRANTED;
  }

  return true;
}

/**
 * Foreground + background permissions for both Android and iOS.
 * On iOS, background location requires the "Always" permission level.
 */
export async function requestBackgroundLocationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    return requestLocationPermission(true);
  }
  // iOS: request background ("always") permission directly
  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return bgStatus === Location.PermissionStatus.GRANTED;
}

export async function getCurrentPosition(machineId: string): Promise<LocationReportDto | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return coordsToReport(machineId, loc);
  } catch {
    return null;
  }
}

export async function startLocationWatcher(
  machineId: string,
  onLocation: (report: LocationReportDto) => void,
): Promise<Location.LocationSubscription | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;

  return Location.watchPositionAsync(
    {
      // Balanced accuracy is sufficient for geofence and conserves battery.
      // distanceInterval ensures we don't flood on stationary devices.
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15_000,
      distanceInterval: 50,
    },
    (loc) => {
      onLocation(coordsToReport(machineId, loc));
    },
  );
}

export function stopLocationWatcher(sub: Location.LocationSubscription): void {
  sub.remove();
}

/**
 * Start background location updates via TaskManager.
 * Android: uses a foreground service so the task survives when the app is backgrounded.
 * iOS: uses UIBackgroundModes "location" (configured in app.json infoPlist).
 * Requires background location permission on both platforms.
 */
export async function startBackgroundLocationTracking(machineId: string): Promise<void> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== Location.PermissionStatus.GRANTED) {
    mobileLogger.warn('startBackgroundLocationTracking: foreground location not granted');
    return;
  }
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== Location.PermissionStatus.GRANTED) {
    mobileLogger.warn('startBackgroundLocationTracking: background location not granted');
    return;
  }

  await writeMachineIdToDisk(machineId);

  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
  if (already) {
    await Location.stopLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
  }

  await Location.startLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME, {
    // Balanced accuracy is sufficient for geofence checks and conserves battery.
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15_000,
    distanceInterval: 50,
    pausesUpdatesAutomatically: false,
    // iOS-specific options (ignored on Android)
    activityType: Location.ActivityType.OtherNavigation,
    showsBackgroundLocationIndicator: true,
    // Android-specific: keeps the process alive as a foreground service
    foregroundService: {
      notificationTitle: 'StrawBoss — locație activă',
      notificationBody: 'Transmitem poziția în câmp către dispecer.',
      notificationColor: '#0A5C36',
    },
  });

  mobileLogger.flow('Background location updates started', { machineId, platform: Platform.OS });
}

export async function stopBackgroundLocationTracking(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
    if (started) {
      await Location.stopLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
    }
  } catch (err) {
    mobileLogger.warn('stopBackgroundLocationTracking', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  await clearMachineIdFile();
  mobileLogger.flow('Background location updates stopped');
}

export async function isBackgroundLocationTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
  } catch {
    return false;
  }
}

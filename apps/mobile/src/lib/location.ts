/**
 * GPS location for StrawBoss mobile: foreground helpers + background updates
 * (TaskManager + foreground service on Android, UIBackgroundModes on iOS)
 * posting to POST /api/v1/location/report.
 */
import { AppState, Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiClient, ApiError } from '@strawboss/api';
import type { LocationReportDto } from '@strawboss/types';
import { getAuthToken } from './auth';
import { mobileLogger } from './logger';
import { runBackgroundSyncCycle } from '../sync/run-background-sync';
import { maybeRaiseGeofenceWake } from './geofence-wake';
import { runDeviceCheckin } from './device-checkin';

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

// A queued GPS fix older than this is operationally useless — the dispatcher wants
// the CURRENT position, not where a frozen phone was half an hour ago. Critically,
// on OEM ROMs that freeze the foreground service mid-flush (HONOR/MagicOS
// PowerGenie), replaying a large stale backlog forever is exactly what pins a
// phone's position in the past (one device re-inserted ~18k duplicate pings/day, all
// stamped with a single 2-minute-old window). Drop anything older before flushing.
const MAX_REPORT_AGE_MS = 30 * 60_000; // 30 min

// ---------------------------------------------------------------------------
// FM-15 — Adaptive GPS tracking
// ---------------------------------------------------------------------------
/** Speed threshold (km/h) above which we consider the machine on a road */
const ROAD_SPEED_KMH = 30;
/** Speed threshold (km/h) below which we consider the machine in a field */
const FIELD_SPEED_KMH = 10;

/** File that caches the last known speed estimate for the background task */
const LAST_SPEED_FILE = `${doc}strawboss-location-last-speed.txt`;

async function writeLastSpeedKmh(speedKmh: number): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(LAST_SPEED_FILE, String(speedKmh));
  } catch {
    /* non-critical */
  }
}

async function readLastSpeedKmh(): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_SPEED_FILE);
    if (!info.exists) return null;
    const raw = (await FileSystem.readAsStringAsync(LAST_SPEED_FILE)).trim();
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Classify the current speed into a tracking profile.
 * - road  (>30 km/h): less frequent updates, Balanced accuracy
 * - field (<10 km/h): frequent updates, High accuracy
 * - transition (10-30 km/h): Balanced accuracy, medium interval
 *
 * All profiles report on a TIME basis (`distanceInterval: 0`), never gated on
 * movement. A non-zero `distanceInterval` maps to Android `smallestDisplacement`,
 * which suppresses every update until the device has physically moved that far —
 * so a *stationary* machine (a truck parked at the loader, a loader idling)
 * stops reporting GPS entirely. That silently breaks loader↔truck proximity
 * (`trucks-at-loader` / `loaders-near-truck` only match positions fresher than
 * `windowMinutes`) and can deadlock a vehicle that parks from road speed — it
 * gets no callback, so it never re-classifies down to the field profile. Keeping
 * reporting purely time-based guarantees a fresh position even when idle and
 * keeps the adaptive re-classification callbacks flowing.
 */
type SpeedProfile = 'road' | 'field' | 'transition';

function classifySpeed(speedKmh: number | null): SpeedProfile {
  if (speedKmh === null) return 'field'; // unknown → assume field (safer)
  if (speedKmh > ROAD_SPEED_KMH) return 'road';
  if (speedKmh < FIELD_SPEED_KMH) return 'field';
  return 'transition';
}

interface TrackingParams {
  accuracy: Location.Accuracy;
  timeInterval: number;
  distanceInterval: number;
}

function trackingParamsForProfile(profile: SpeedProfile): TrackingParams {
  switch (profile) {
    case 'road':
      // Road: fast-moving — lighter cadence to save battery (still time-based).
      return {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30_000,
        distanceInterval: 0,
      };
    case 'field':
      // Field: slow-moving or idle — frequent, time-based pings so a stationary
      // machine stays fresh for geofence + loader↔truck proximity.
      return {
        accuracy: Location.Accuracy.High,
        timeInterval: 20_000,
        distanceInterval: 0,
      };
    case 'transition':
    default:
      return {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20_000,
        distanceInterval: 0,
      };
  }
}

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

/**
 * Public accessor for the persisted machine id. Used by the boot re-arm headless
 * task and the tracking watchdog to decide whether background tracking *should*
 * be running (the id is written when tracking starts, cleared on logout/stop).
 */
export async function getPersistedMachineId(): Promise<string | null> {
  return readMachineIdFromDisk();
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

async function writePendingReports(
  reports: LocationReportDto[],
  warnNearCapacity = false,
): Promise<void> {
  // Only warn when the queue is GROWING (an append) — not on every incremental
  // writeback while we drain it, which would spam the same warning ~40×.
  if (warnNearCapacity && reports.length >= PENDING_REPORTS_WARN_THRESHOLD) {
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
  await writePendingReports(cur, true);
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

/**
 * A location report rejected with a permanent client error (4xx, excluding
 * auth/throttle) will fail identically on every retry — so re-queueing it just
 * re-floods the server. This is the "Machine not found in your organization"
 * 400 storm: a stale/cross-org `machineId` posted ~11×/s for hours because the
 * outbox kept re-flushing it. Drop such reports and surface the misconfig;
 * keep retrying only genuinely transient failures (offline/network, 5xx, 401
 * after refresh, 408, 429) so a real position is never lost.
 */
function isPermanentReportError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 401 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/**
 * Retry outbox after failed background POSTs (e.g. offline / 401).
 *
 * Crash-safe and age-bounded by design, because this runs inside a foreground
 * service that OEM ROMs (HONOR/MagicOS PowerGenie) freeze without warning:
 *   1. Stale reports are dropped up front and the trim is persisted immediately,
 *      so even if we're frozen before posting anything the zombie backlog is gone.
 *   2. We persist progress after EACH report. A freeze mid-loop therefore resumes
 *      where it left off instead of replaying the whole queue — the old "post all,
 *      then write back once" shape never reached the writeback under a freeze, so
 *      it re-posted the same backlog every wake (thousands of dup pings/day).
 */
export async function flushPendingLocationReports(): Promise<void> {
  let pending = await readPendingReports();
  if (pending.length === 0) return;

  // 1. Drop stale reports, then persist the trim before doing any network work.
  const cutoff = Date.now() - MAX_REPORT_AGE_MS;
  const fresh = pending.filter((r) => {
    const t = Date.parse(r.recordedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (fresh.length !== pending.length) {
    mobileLogger.flow('Dropped stale location reports from outbox', {
      dropped: pending.length - fresh.length,
      kept: fresh.length,
    });
    await writePendingReports(fresh);
  }
  pending = fresh;

  // 2. Flush incrementally, persisting after each report so a freeze can't replay.
  while (pending.length > 0) {
    const report = pending[0];
    try {
      await postLocationReport(report);
      await writeLastSuccessTimestamp();
    } catch (err) {
      if (!isPermanentReportError(err)) {
        // Transient (offline / 5xx / 401-408-429): stop and keep the rest queued.
        break;
      }
      mobileLogger.warn('Location report dropped from outbox (permanent 4xx)', {
        status: err.status,
        machineId: report.machineId,
        message: err.message,
      });
      // Permanent 4xx — fall through to drop it from the queue.
    }
    pending = pending.slice(1);
    await writePendingReports(pending);
  }
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
    if (isPermanentReportError(err)) {
      mobileLogger.warn('Location report dropped (foreground ping, permanent 4xx)', {
        status: err.status,
        machineId,
        message: err.message,
      });
      return;
    }
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

// ---------------------------------------------------------------------------
// Continuous background sync (piggybacked on the location foreground service)
// ---------------------------------------------------------------------------
// The location foreground service wakes JS every ~10–30 s (adaptive). We reuse
// that wake-up to run a full push/pull sync so structured data (trips, fuel,
// bales, notifications) flows in near-real-time with the screen off, instead of
// waiting for the OS-floored 15 min `expo-background-task`. Guarded so a slow or
// failing sync can never overlap itself nor delay/break location posting.
let syncInFlight = false;
let lastSyncAtMs = 0;
// Minimum spacing between piggybacked syncs. The location foreground service
// wakes JS every ~10–30 s; without this throttle a full push/pull sync would
// run on nearly every wake-up and contend with on-screen queries on the shared
// JS/SQLite thread (the cause of the "details load slowly" jank).
//
// Foreground is throttled HARD: while the app is open the user already has
// pull-to-refresh, event-driven syncs (trip/delivery transitions) and the REST
// polling hooks for live views, so a frequent full sync there mostly just
// causes jank. Background stays tighter so the dispatcher still sees field data
// without large lag while the screen is off.
const PIGGYBACK_SYNC_MIN_INTERVAL_FG_MS = 120_000;
const PIGGYBACK_SYNC_MIN_INTERVAL_BG_MS = 60_000;

async function maybePiggybackSync(): Promise<void> {
  const now = Date.now();
  if (syncInFlight) return; // re-entrancy guard — a previous cycle is still running
  const minInterval =
    AppState.currentState === 'active'
      ? PIGGYBACK_SYNC_MIN_INTERVAL_FG_MS
      : PIGGYBACK_SYNC_MIN_INTERVAL_BG_MS;
  if (now - lastSyncAtMs < minInterval) return; // throttle (state-dependent)
  syncInFlight = true;
  lastSyncAtMs = now;
  try {
    await runBackgroundSyncCycle();
  } catch (err) {
    mobileLogger.warn('Piggyback sync failed (isolated)', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    syncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Device check-in piggybacked on the location foreground service
// ---------------------------------------------------------------------------
// Presence/online normally rides a native AlarmManager tick, but aggressive OEM
// ROMs (Samsung One UI, HONOR) THROTTLE that exact-while-idle alarm in Doze to
// ~once per 9 min even for a battery-opt-exempt Device Owner — so the device dot
// flaps offline with the screen off. Empirically (Galaxy S25 soak), the location
// foreground service is the ONE background path One UI keeps alive: GPS posted
// every ~20 s for 10 min screen-off while the alarm was frozen 8.5 min. So we run
// the FULL fleet check-in (device last_seen + Tailscale/OTA/remote-command
// delivery) from here too, throttled to ~55 s. Fire-and-forget + re-entrancy
// guarded so it can never delay or break GPS posting.
let checkinInFlight = false;
let lastCheckinAtMs = 0;
const PIGGYBACK_CHECKIN_MIN_INTERVAL_MS = 55_000;

async function maybePresenceCheckin(): Promise<void> {
  if (checkinInFlight) return;
  const now = Date.now();
  if (now - lastCheckinAtMs < PIGGYBACK_CHECKIN_MIN_INTERVAL_MS) return;
  checkinInFlight = true;
  lastCheckinAtMs = now;
  try {
    await runDeviceCheckin();
  } catch (err) {
    mobileLogger.warn('Piggyback checkin failed (isolated)', {
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    checkinInFlight = false;
  }
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

  // Presence/online rides the location foreground service here (the Doze-proof
  // path on Samsung/HONOR) — placed BEFORE the no-machine early-return so the
  // device keeps checking in even in keep-alive mode. Throttled + fire-and-forget.
  void maybePresenceCheckin();

  const machineId = await readMachineIdFromDisk();
  if (!machineId) {
    mobileLogger.debug('Location task: no machine id on disk, presence-only tick');
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  // FM-15: derive speed from the last location in the batch, persist for
  // adaptive restart decision (see restartWithAdaptiveParams).
  const lastLoc = locations[locations.length - 1];
  let speedKmh: number | null = null;
  if (lastLoc) {
    const rawSpeed = lastLoc.coords.speed; // m/s from platform, negative if unavailable
    if (rawSpeed !== null && rawSpeed !== undefined && rawSpeed >= 0) {
      speedKmh = rawSpeed * 3.6;
    }
  }
  if (speedKmh !== null) {
    await writeLastSpeedKmh(speedKmh);
  }

  for (const loc of locations) {
    const report = coordsToReport(machineId, loc);
    try {
      await postLocationReport(report);
      await writeLastSuccessTimestamp();
      mobileLogger.debug('Location report OK (background)', {
        machineId,
        lat: report.lat,
        lon: report.lon,
        speedKmh,
      });
    } catch (err) {
      if (isPermanentReportError(err)) {
        mobileLogger.warn('Location report dropped (background, permanent 4xx)', {
          status: err.status,
          machineId,
          message: err.message,
        });
        continue; // drop — re-queueing a permanent failure just re-floods the server
      }
      const msg = err instanceof Error ? err.message : String(err);
      mobileLogger.warn('Location report failed (background), queued for retry', {
        machineId,
        message: msg,
      });
      await appendPendingReport(report);
    }
  }

  // Continuous background sync: fire-and-forget (never awaited) so a sync error
  // or slow network can never delay/break location posting. Debounced + guarded
  // inside maybePiggybackSync.
  void maybePiggybackSync();

  // Client-side geofence wake: detect boundary crossings against local geometry
  // and bring the app to the foreground (over any app / lock screen) on a fresh
  // crossing. Fire-and-forget + edge-triggered + debounced inside the helper, so
  // it can never delay/break location posting.
  if (lastLoc) {
    void maybeRaiseGeofenceWake(machineId, {
      lat: lastLoc.coords.latitude,
      lon: lastLoc.coords.longitude,
    });
  }

  // FM-15: after processing the batch, check whether the speed profile has
  // changed enough to warrant restarting with different intervals. We only
  // restart when the profile changes category (road ↔ field ↔ transition) to
  // avoid excessive restarts due to momentary speed fluctuations.
  await restartWithAdaptiveParamsIfNeeded(machineId, speedKmh);
});

// ---------------------------------------------------------------------------
// FM-15 — Adaptive restart helper (called from background task)
// ---------------------------------------------------------------------------

/** File that caches the last speed profile so we can detect profile changes */
const LAST_PROFILE_FILE = `${doc}strawboss-location-last-profile.txt`;

async function writeLastProfile(profile: SpeedProfile): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(LAST_PROFILE_FILE, profile);
  } catch {
    /* non-critical */
  }
}

async function readLastProfile(): Promise<SpeedProfile | null> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_PROFILE_FILE);
    if (!info.exists) return null;
    const raw = (await FileSystem.readAsStringAsync(LAST_PROFILE_FILE)).trim() as SpeedProfile;
    return ['road', 'field', 'transition'].includes(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Compare the current speed profile with the previously stored one.
 * If the category changed, restart `startLocationUpdatesAsync` with new
 * intervals. This is safe to call from inside the background task on Android
 * (foreground service stays alive during the restart).
 */
async function restartWithAdaptiveParamsIfNeeded(
  machineId: string,
  speedKmh: number | null,
): Promise<void> {
  const newProfile = classifySpeed(speedKmh);
  const lastProfile = await readLastProfile();

  if (lastProfile === newProfile) return; // no change — nothing to do

  await writeLastProfile(newProfile);
  const params = trackingParamsForProfile(newProfile);

  mobileLogger.flow('GPS adaptive profile changed — restarting location updates', {
    from: lastProfile ?? 'unknown',
    to: newProfile,
    speedKmh,
    distanceInterval: params.distanceInterval,
    timeInterval: params.timeInterval,
  });

  try {
    // Re-start with new params. stopLocationUpdatesAsync + immediate start
    // causes a brief gap (~1-2s) which is acceptable for field use.
    await Location.stopLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME);
    await Location.startLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME, {
      accuracy: params.accuracy,
      timeInterval: params.timeInterval,
      distanceInterval: params.distanceInterval,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'StrawBoss — locație activă',
        notificationBody: 'Transmitem poziția în câmp către dispecer.',
        notificationColor: '#0A5C36',
      },
    });
  } catch (err) {
    mobileLogger.warn('GPS adaptive restart failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

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

  // FM-15: start with adaptive params based on last known speed (or field
  // profile as a safe default for unknown state).
  const lastSpeedKmh = await readLastSpeedKmh();
  const initialProfile = classifySpeed(lastSpeedKmh);
  const params = trackingParamsForProfile(initialProfile);
  await writeLastProfile(initialProfile);

  mobileLogger.flow('Starting GPS background tracking', {
    machineId,
    profile: initialProfile,
    lastSpeedKmh,
    distanceInterval: params.distanceInterval,
    timeInterval: params.timeInterval,
  });

  await Location.startLocationUpdatesAsync(LOCATION_UPDATES_TASK_NAME, {
    accuracy: params.accuracy,
    timeInterval: params.timeInterval,
    distanceInterval: params.distanceInterval,
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

/** Location/tracking subsystem snapshot for the self-health report (never throws). */
export async function getLocationHealthSnapshot(): Promise<{
  assignedMachineId: string | null;
  backgroundTrackingActive: boolean;
  lastLocationReportAt: string | null;
  lastSpeedKmh: number | null;
  lastProfile: string | null;
  pendingLocationReports: number;
}> {
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  return {
    assignedMachineId: await safe(() => readMachineIdFromDisk(), null),
    backgroundTrackingActive: await isBackgroundLocationTrackingActive(),
    lastLocationReportAt: await readLastLocationSuccessIso(),
    lastSpeedKmh: await safe(() => readLastSpeedKmh(), null),
    lastProfile: await safe(() => readLastProfile(), null),
    pendingLocationReports: await safe(async () => (await readPendingReports()).length, 0),
  };
}

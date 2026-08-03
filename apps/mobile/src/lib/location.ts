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
import { runDeviceCheckin, hasActiveTrip } from './device-checkin';

export type { LocationSubscription } from 'expo-location';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Task name for `Location.startLocationUpdatesAsync` / `hasStartedLocationUpdatesAsync`. */
export const LOCATION_UPDATES_TASK_NAME = 'strawboss-location-updates';

const doc = FileSystem.documentDirectory ?? '';
const MACHINE_ID_FILE = `${doc}strawboss-location-machine-id.txt`;
const PENDING_REPORTS_FILE = `${doc}strawboss-pending-location-reports.json`;
const LAST_SUCCESS_FILE = `${doc}strawboss-location-last-success.txt`;
// Sibling of LAST_SUCCESS_FILE, but for a different purpose: LAST_SUCCESS_FILE
// tracks the last successful POST for the UI health snapshot (updated by
// foreground pings, best-effort pings, AND flushes alike). This one gates how
// often the background task attempts a flush at all, so it must be updated on
// every attempt (success or failure) — reusing LAST_SUCCESS_FILE would let a
// recent foreground ping suppress a due background flush, or let an offline
// stretch (no successes) retry every ~20-30s tick instead of every ~60s.
const LAST_FLUSH_ATTEMPT_FILE = `${doc}strawboss-location-last-flush-attempt.txt`;

const MAX_PENDING_REPORTS = 400;
const PENDING_REPORTS_WARN_THRESHOLD = Math.floor(MAX_PENDING_REPORTS * 0.9);
// Batch transport: chunk size for POST /api/v1/location/report/batch (server
// enforces the same 30-item cap). Gate below throttles how often the
// background task even attempts a flush, independent of this chunk size.
const BATCH_CHUNK_SIZE = 30;
// Minimum spacing between background-task flush attempts. GPS capture cadence
// (20-30s, unchanged) is much tighter than this — fixes accumulate in the
// outbox between flushes so they go out in a handful of ≤30-item batches
// instead of one request per fix (~150/h/phone -> ~once/min/phone).
const BACKGROUND_FLUSH_MIN_INTERVAL_MS = 60_000;

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

/**
 * All three profiles request `Accuracy.High`. They used to differ — road and
 * transition asked for `Balanced` to save battery — but on Android that maps to
 * PRIORITY_BALANCED_POWER_ACCURACY, which lets the platform answer with a
 * Wi-Fi/cell-tower fix instead of a GNSS one. Those fixes arrive with a
 * suspiciously round ~100 m accuracy and can land tens of kilometres from the
 * machine; on the admin Trasee map they drew a fan of straight lines across the
 * whole county, and they inflated a telehandler's monthly distance roughly
 * fivefold. Battery is saved through CADENCE (timeInterval) instead — the
 * foreground service is running continuously either way, so the delta is the
 * quality of each fix, not how often we wake up.
 *
 * `distanceInterval` stays 0 on every profile — see the note above on why a
 * non-zero value silently stops a stationary machine from reporting at all.
 */
function trackingParamsForProfile(profile: SpeedProfile): TrackingParams {
  switch (profile) {
    case 'road':
      // Road: fast-moving — lighter cadence to save battery (still time-based).
      return {
        accuracy: Location.Accuracy.High,
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
        accuracy: Location.Accuracy.High,
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

async function writeLastFlushAttempt(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(LAST_FLUSH_ATTEMPT_FILE, String(Date.now()));
  } catch {
    /* non-critical */
  }
}

async function readLastFlushAttemptMs(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_FLUSH_ATTEMPT_FILE);
    if (!info.exists) return 0;
    const raw = (await FileSystem.readAsStringAsync(LAST_FLUSH_ATTEMPT_FILE)).trim();
    const v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

async function postLocationReport(report: LocationReportDto): Promise<void> {
  await locationApiClient.post<void>('/api/v1/location/report', report);
}

async function postLocationReportsBatch(reports: LocationReportDto[]): Promise<void> {
  await locationApiClient.post<void>('/api/v1/location/report/batch', { reports });
}

/**
 * Old backend during a rollout window won't have `/report/batch` yet. Once we
 * observe a 404 (no route) or 405 (method not allowed) we stop probing it and
 * fall back to the single-report endpoint for the rest of the process
 * lifetime — no need to keep re-discovering the same fact.
 */
let batchUnsupported = false;

function isBatchUnsupportedError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

/**
 * Same cross-org/misconfigured-`machineId` incident class as
 * {@link isPermanentReportError} (the "Machine not found in your
 * organization" 400 storm): a bad report inside a batch fails identically on
 * every retry, so the whole chunk is dropped rather than retried forever.
 * Narrower than {@link isPermanentReportError} on purpose — only 400/403 drop
 * the chunk; anything else (401/408/429/5xx, or an unrecognized 4xx) is
 * treated as transient so good data is never silently discarded on the batch
 * path.
 */
function isBatchPermanentDropError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 400 || err.status === 403);
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
 * Batch phase of the flush: sends chunks of <= BATCH_CHUNK_SIZE via
 * POST /api/v1/location/report/batch, persisting the outbox after EACH chunk
 * (same crash-safety guarantee as the single-report loop below — a freeze
 * mid-flush on HONOR/MagicOS resumes from where it left off, never replays).
 * Returns whatever is still left in the queue: either because a transient
 * error stopped the loop (kept for the next flush attempt), or because the
 * batch endpoint turned out to be unsupported (`batchUnsupported` flips true
 * and the caller falls back to the single-report loop for the remainder).
 */
async function flushPendingLocationReportsBatched(
  pending: LocationReportDto[],
): Promise<LocationReportDto[]> {
  while (pending.length > 0 && !batchUnsupported) {
    const chunk = pending.slice(0, BATCH_CHUNK_SIZE);
    try {
      await postLocationReportsBatch(chunk);
      await writeLastSuccessTimestamp();
      pending = pending.slice(chunk.length);
      await writePendingReports(pending);
    } catch (err) {
      if (isBatchUnsupportedError(err)) {
        // Rollout window with an old backend: no /report/batch route yet.
        // Don't drop the chunk — fall back to posting it (and everything
        // after it) one at a time below, now and on subsequent flushes.
        mobileLogger.flow(
          'Location batch endpoint unsupported (404/405) — falling back to single-report POSTs',
          { pendingCount: pending.length },
        );
        batchUnsupported = true;
        break;
      }
      if (isBatchPermanentDropError(err)) {
        mobileLogger.warn('Location report batch dropped from outbox (permanent 4xx)', {
          status: err.status,
          chunkSize: chunk.length,
          message: err.message,
        });
        pending = pending.slice(chunk.length);
        await writePendingReports(pending);
        continue;
      }
      // Transient (offline / 5xx / 401-408-429): stop and keep the rest queued.
      break;
    }
  }
  return pending;
}

/**
 * Single-report fallback loop (pre-batch behavior), used once the batch
 * endpoint is known unsupported. Persists progress after EACH report so a
 * freeze mid-loop resumes instead of replaying the whole queue.
 */
async function flushPendingLocationReportsSingle(pending: LocationReportDto[]): Promise<void> {
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
 * Retry outbox after failed/queued POSTs (e.g. offline / 401), or drain fixes
 * appended by the background task's batch transport.
 *
 * Crash-safe and age-bounded by design, because this runs inside a foreground
 * service that OEM ROMs (HONOR/MagicOS PowerGenie) freeze without warning:
 *   1. Stale reports are dropped up front and the trim is persisted immediately,
 *      so even if we're frozen before posting anything the zombie backlog is gone.
 *   2. We persist progress after EACH chunk/report. A freeze mid-loop therefore
 *      resumes where it left off instead of replaying the whole queue — the old
 *      "post all, then write back once" shape never reached the writeback under
 *      a freeze, so it re-posted the same backlog every wake (thousands of dup
 *      pings/day). This guarantee holds for both the batch and single-report
 *      phases below.
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

  // 2. Batch transport first (chunks of <= BATCH_CHUNK_SIZE), unless we've
  // already learned this backend doesn't support it.
  if (!batchUnsupported) {
    pending = await flushPendingLocationReportsBatched(pending);
  }

  // 3. Only reached when the batch endpoint just turned out unsupported (or
  // was already known unsupported from an earlier flush) — drain the rest
  // one report at a time, same semantics as before this feature existed.
  if (batchUnsupported && pending.length > 0) {
    await flushPendingLocationReportsSingle(pending);
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

/**
 * Largest accuracy we will report. The server clamps too (and the column was
 * widened in migration 00095), but a value that survives round-tripping through
 * the outbox is cheaper to bound here. Anything this coarse is discarded when
 * the track is drawn anyway — it is kept only because a rough position still
 * answers "roughly where is this machine" for presence and geofencing.
 */
const MAX_REPORTED_ACCURACY_M = 9_999_999;

/**
 * Ceiling of usefulness for the best-effort presence fix. Production measured
 * check-in fixes claiming 2.5–6.3 km of error — positions that mislead every
 * consumer they have (the "near <locality>" card, loader↔truck proximity,
 * geofence). Past this we post nothing; presence itself rides the check-in
 * call, not the fix.
 */
const CHECKIN_MAX_USEFUL_ACCURACY_M = 2_000;

function coordsToReport(
  machineId: string,
  loc: Location.LocationObject,
  source: 'task' | 'checkin' = 'task',
): LocationReportDto {
  const rawAccuracy = loc.coords.accuracy;
  const accuracyM =
    typeof rawAccuracy === 'number' && Number.isFinite(rawAccuracy) && rawAccuracy >= 0
      ? Math.min(rawAccuracy, MAX_REPORTED_ACCURACY_M)
      : null;

  return {
    machineId,
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    accuracyM,
    headingDeg: loc.coords.heading ?? null,
    speedMs: loc.coords.speed ?? null,
    recordedAt: new Date(loc.timestamp).toISOString(),
    // 'checkin' marks the best-effort presence fix (network quality) so the
    // server can keep it OFF tracks and distance reports. See
    // getBestEffortPosition for why those fixes must never draw a polyline.
    source,
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
//
// D4: background itself is adaptive — a machine mid-trip needs its structured
// data (loads, fuel, task assignments) flowing near-real-time, but an idle
// machine with no active trip can wait longer, so we back off to save battery
// / network on the ~30-phone fleet.
const PIGGYBACK_SYNC_MIN_INTERVAL_FG_MS = 120_000;
const PIGGYBACK_SYNC_MIN_INTERVAL_BG_ACTIVE_TRIP_MS = 60_000;
const PIGGYBACK_SYNC_MIN_INTERVAL_BG_IDLE_MS = 180_000;

// hasActiveTrip() reads SQLite; cache its result briefly so a background tick
// every ~20-30s doesn't hit the DB on every single wake.
const ACTIVE_TRIP_CACHE_TTL_MS = 60_000;
let cachedHasActiveTrip = false;
let cachedHasActiveTripAtMs = 0;

async function hasActiveTripCached(): Promise<boolean> {
  const now = Date.now();
  if (now - cachedHasActiveTripAtMs < ACTIVE_TRIP_CACHE_TTL_MS) return cachedHasActiveTrip;
  cachedHasActiveTrip = await hasActiveTrip();
  cachedHasActiveTripAtMs = now;
  return cachedHasActiveTrip;
}

async function maybePiggybackSync(): Promise<void> {
  const now = Date.now();
  if (syncInFlight) return; // re-entrancy guard — a previous cycle is still running
  let minInterval: number;
  if (AppState.currentState === 'active') {
    minInterval = PIGGYBACK_SYNC_MIN_INTERVAL_FG_MS;
  } else {
    const activeTrip = await hasActiveTripCached();
    minInterval = activeTrip
      ? PIGGYBACK_SYNC_MIN_INTERVAL_BG_ACTIVE_TRIP_MS
      : PIGGYBACK_SYNC_MIN_INTERVAL_BG_IDLE_MS;
  }
  // Fleet-wide desync: ~30 phones on identical fixed periods would otherwise
  // synchronize into simultaneous request bursts. Jitter +/-10% per check.
  const jitter = 0.9 + Math.random() * 0.2;
  if (now - lastSyncAtMs < minInterval * jitter) return; // throttle (state-dependent)
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
  // Fleet-wide desync: jitter +/-10% so 30 phones don't all check in on the
  // exact same cadence and pile up on the server at once.
  const jitter = 0.9 + Math.random() * 0.2;
  if (now - lastCheckinAtMs < PIGGYBACK_CHECKIN_MIN_INTERVAL_MS * jitter) return;
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

// ---------------------------------------------------------------------------
// Batch transport: gate for how often the background task attempts a flush
// ---------------------------------------------------------------------------
// GPS fixes are captured every 20-30s (adaptive profile, unchanged) but we
// only want the outbox to actually hit the network about once a minute — the
// background task appends every fix to the outbox unconditionally, and this
// gate decides whether THIS tick is the one that flushes it. Persisted to
// disk (not a module var like syncInFlight/checkinInFlight above) because
// this exact background task is documented elsewhere in this file to survive
// OEM freezes/HeadlessJS cold-starts that can hand a tick to a fresh JS
// context — a module var would silently reset the throttle in that case.
export async function maybeFlushBatchedLocationReports(): Promise<void> {
  const now = Date.now();
  const last = await readLastFlushAttemptMs();
  if (now - last < BACKGROUND_FLUSH_MIN_INTERVAL_MS) return;
  await writeLastFlushAttempt();
  await flushPendingLocationReports();
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

  // Drains whatever is already queued (previous ticks' appends, or backlog
  // left over from before batching existed), gated to ~once/60s so this
  // doesn't fire on every 20-30s tick.
  await maybeFlushBatchedLocationReports();

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

  // Batch transport: queue every fix instead of posting it individually — the
  // gated flush above (and on the next tick(s) once ~60s has elapsed) drains
  // the outbox via chunked POST /report/batch. GPS capture cadence (20-30s)
  // is unchanged; only the transport to the server is batched.
  for (const loc of locations) {
    const report = coordsToReport(machineId, loc);
    await appendPendingReport(report);
  }
  mobileLogger.debug('Location fixes queued (background, batched)', {
    machineId,
    count: locations.length,
    speedKmh,
  });

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

/**
 * Best-effort position for the alarm-driven headless path on OEM ROMs that FREEZE
 * the app between native-alarm ticks (HONOR/MagicOS PowerGenie). A High-accuracy
 * `getCurrentPositionAsync` needs a GPS lock that can take 5–30 s — long enough for
 * the OEM to re-freeze the app before it returns, so nothing lands (verified on a
 * HONOR NLA-LX1: presence/check-in flowed every ~20 s screen-off but GPS never did).
 * Strategy that lands a fresh-ish fix inside the short alarm window instead:
 *   1) last-known (instant, ≤10 min old) — guarantees SOMETHING lands even if the
 *      app is re-frozen immediately after;
 *   2) a Balanced (fused cell/wifi) fix with a hard 10 s timeout — fast (~1–3 s),
 *      works indoors, and replaces the last-known when it arrives.
 * Accuracy is coarser (~100 m) than the foreground 20 s GPS FGS, but a fresh coarse
 * position every 60 s beats no position at all while the phone is frozen.
 */
export async function getBestEffortPosition(machineId: string): Promise<LocationReportDto | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;

  let report: LocationReportDto | null = null;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    if (last) report = coordsToReport(machineId, last, 'checkin');
  } catch {
    /* ignore — fall through to the fresh fix */
  }
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (fresh) report = coordsToReport(machineId, fresh, 'checkin');
  } catch {
    /* ignore — keep the last-known fallback if we got one */
  }
  // A fix that admits being multiple kilometres off serves nobody: it is
  // excluded from tracks by its 'checkin' tag anyway, and for presence it
  // actively misleads ("near <wrong locality>", phantom geofence proximity).
  // Better to report nothing — presence itself still flows via the check-in.
  if (report && report.accuracyM != null && report.accuracyM > CHECKIN_MAX_USEFUL_ACCURACY_M) {
    return null;
  }
  return report;
}

/**
 * Post a best-effort position (the HONOR alarm path), queueing on transient failure.
 * Mirror of {@link postCurrentLocationNow} but using {@link getBestEffortPosition}.
 */
export async function postBestEffortLocationNow(machineId: string): Promise<void> {
  const report = await getBestEffortPosition(machineId);
  if (!report) return;
  try {
    await postLocationReport(report);
    await writeLastSuccessTimestamp();
  } catch (err) {
    if (isPermanentReportError(err)) {
      mobileLogger.warn('Best-effort location dropped (permanent 4xx)', {
        status: err.status,
        machineId,
        message: err.message,
      });
      return;
    }
    await appendPendingReport(report);
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

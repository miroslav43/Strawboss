/**
 * Fleet Management — Device Check-in + OTA self-update orchestration.
 *
 * Registers/identifies this install with the server, reports OTA progress, and
 * drives silent APK installs when a PendingDeployment is handed back.
 *
 * The check-in endpoint is PUBLIC (no auth header needed) — this is intentional
 * so fleet telemetry works even before an operator logs in.
 *
 * Persistence layout in SecureStore:
 *   strawboss.device_id       — stable device UUID (created once, never changes)
 *   strawboss.device_token    — HMAC token issued by server on first check-in
 *   strawboss.ota_mirror      — JSON: OtaMirror (current deployment state)
 *   strawboss.pending_install_deployment_id — set just before installApkSilent()
 *                               so post-restart boot-rearm can report success
 */
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { ApiClient } from '@strawboss/api';
import type {
  DeviceCheckinRequest,
  DeviceCheckinResponse,
  DeviceCommand,
  DeviceCommandReport,
  DeviceOtaReport,
  OtaState,
  PendingDeployment,
} from '@strawboss/types';
import { generateUuid } from './uuid';
import {
  isDeviceOwner,
  getDeviceHardwareInfo,
  isPackageInstalled,
  installApkSilent,
  setTailscaleManaged,
  clearTailscaleManaged,
} from './device-owner';
import { getDatabase } from './storage';
import { TripsRepo } from '../db/trips-repo';
import { mobileLogger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEVICE_ID_KEY = 'strawboss.device_id';
const DEVICE_TOKEN_KEY = 'strawboss.device_token';
const OTA_MIRROR_KEY = 'strawboss.ota_mirror';
/** Set just before installApkSilent() — read on boot-rearm to report `installed`. */
export const PENDING_INSTALL_DEPLOYMENT_ID_KEY = 'strawboss.pending_install_deployment_id';

/**
 * JSON-serialised array of DeviceCommandReport objects awaiting delivery.
 * Written after each command is applied; cleared after a successful POST.
 */
const COMMAND_REPORTS_KEY = 'strawboss.command_reports';

/**
 * Last-applied Tailscale action ('up' | 'down' | null).
 * Used to skip a redundant native call while still reporting success.
 */
const TAILSCALE_APPLIED_STATE_KEY = 'strawboss.tailscale_state';

const MAX_INSTALL_ATTEMPTS = 3;

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Unauthenticated API client — public fleet endpoint
// ---------------------------------------------------------------------------

/**
 * A dedicated ApiClient instance that sends NO Authorization header.
 * Mirrors the baseUrl resolution in src/lib/api-client.ts but uses
 * `getToken: async () => null` so the fleet/checkin endpoint (which is
 * public) is not inadvertently associated with a user session.
 */
const fleetApiClient = new ApiClient({
  baseUrl: API_URL,
  getToken: async () => null,
});

// ---------------------------------------------------------------------------
// Device identity persistence
// ---------------------------------------------------------------------------

/**
 * Read or create the stable device UUID stored in SecureStore.
 * Also returns the persisted device token (null on first run).
 */
export async function ensureDeviceId(): Promise<{
  deviceUuid: string;
  deviceToken: string | null;
}> {
  let deviceUuid = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceUuid) {
    deviceUuid = generateUuid();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceUuid);
    mobileLogger.flow('Fleet: new device UUID created', { deviceUuid });
  }
  const deviceToken = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
  return { deviceUuid, deviceToken };
}

// ---------------------------------------------------------------------------
// OTA mirror — local state kept in SecureStore
// ---------------------------------------------------------------------------

interface OtaMirror {
  deploymentId: string;
  version: string;
  versionCode: number;
  sha256: string;
  apkUrl: string;
  sizeBytes: number;
  localUri: string | null;
  state: OtaState;
  attempt: number;
  /** Pending reports to be sent on the next check-in. */
  reports: DeviceOtaReport[];
}

async function readOtaMirror(): Promise<OtaMirror | null> {
  try {
    const raw = await SecureStore.getItemAsync(OTA_MIRROR_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OtaMirror;
  } catch {
    return null;
  }
}

async function writeOtaMirror(mirror: OtaMirror): Promise<void> {
  await SecureStore.setItemAsync(OTA_MIRROR_KEY, JSON.stringify(mirror));
}

async function clearOtaMirror(): Promise<void> {
  await SecureStore.deleteItemAsync(OTA_MIRROR_KEY);
}

/** Append a report to the mirror (and persist). */
async function appendOtaReport(
  mirror: OtaMirror,
  state: OtaState,
  error?: string,
): Promise<OtaMirror> {
  const updated: OtaMirror = { ...mirror, state, reports: [...mirror.reports] };
  // Replace any existing report for the same deploymentId+state or just push.
  const idx = updated.reports.findIndex(
    (r) => r.deploymentId === mirror.deploymentId && r.state === state,
  );
  const report: DeviceOtaReport = {
    deploymentId: mirror.deploymentId,
    state,
    ...(error ? { error } : {}),
  };
  if (idx >= 0) {
    updated.reports[idx] = report;
  } else {
    updated.reports.push(report);
  }
  await writeOtaMirror(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Command reports — persisted queue flushed on next successful check-in
// ---------------------------------------------------------------------------

async function readCommandReports(): Promise<DeviceCommandReport[]> {
  try {
    const raw = await SecureStore.getItemAsync(COMMAND_REPORTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DeviceCommandReport[];
  } catch {
    return [];
  }
}

async function appendCommandReport(report: DeviceCommandReport): Promise<void> {
  try {
    const existing = await readCommandReports();
    // Replace any prior report for the same commandId (idempotent).
    const filtered = existing.filter((r) => r.commandId !== report.commandId);
    await SecureStore.setItemAsync(COMMAND_REPORTS_KEY, JSON.stringify([...filtered, report]));
  } catch {
    // Non-critical — worst case the server doesn't hear back until next check-in
  }
}

async function clearCommandReports(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(COMMAND_REPORTS_KEY);
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Tailscale applied-state mirror
// ---------------------------------------------------------------------------

async function readTailscaleAppliedState(): Promise<'up' | 'down' | null> {
  try {
    const raw = await SecureStore.getItemAsync(TAILSCALE_APPLIED_STATE_KEY);
    if (raw === 'up' || raw === 'down') return raw;
    return null;
  } catch {
    return null;
  }
}

async function writeTailscaleAppliedState(state: 'up' | 'down'): Promise<void> {
  try {
    await SecureStore.setItemAsync(TAILSCALE_APPLIED_STATE_KEY, state);
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Tailscale command handler
// ---------------------------------------------------------------------------

/**
 * Apply a Tailscale up/down command received from the server.
 * Defensive: never throws. Appends a DeviceCommandReport to the queue so the
 * result is reported on the next check-in.
 *
 * Optimization: if the local applied-state mirror already matches the requested
 * action we skip the native call but still push a success report so the backend
 * knows it is applied.
 */
async function handleTailscaleCommand(command: DeviceCommand): Promise<void> {
  const { id: commandId, action, payload } = command;
  let success = false;
  let errorMsg: string | undefined;

  try {
    const alreadyApplied = await readTailscaleAppliedState();

    if (action === 'up') {
      if (!payload?.authKey || !payload?.hostname || !payload?.tailnet) {
        throw new Error('tailscale:up command missing payload fields');
      }

      if (alreadyApplied === 'up') {
        mobileLogger.flow('Fleet: Tailscale already up — reporting success without native call', {
          commandId,
        });
        success = true;
      } else {
        // Zero-touch auto-install: if Tailscale isn't installed yet, install it
        // silently first (Device Owner) before attempting to configure it.
        const tailscaleInstalled = await isPackageInstalled('com.tailscale.ipn');
        if (!tailscaleInstalled) {
          const apkRef = payload.tailscaleApk;
          if (!apkRef) {
            throw new Error('Tailscale not installed and no APK provided');
          }
          mobileLogger.flow('Fleet: Tailscale not installed — downloading APK', { commandId });
          // Use a per-command filename to avoid collisions (Bug 7).
          const tsApkUri = `${FileSystem.documentDirectory ?? ''}tailscale-install-${commandId}.apk`;
          const fullUrl = `${API_URL}${apkRef.url}`;
          const downloadResult = await FileSystem.downloadAsync(fullUrl, tsApkUri);
          if (downloadResult.status !== 200) {
            // Clean up partial download before throwing.
            await FileSystem.deleteAsync(tsApkUri, { idempotent: true });
            throw new Error(`Tailscale APK download failed with status ${downloadResult.status}`);
          }
          mobileLogger.flow('Fleet: Tailscale APK downloaded — installing', { commandId });
          try {
            const installed = await installApkSilent(
              downloadResult.uri,
              apkRef.sha256,
              'com.tailscale.ipn',
            );
            if (!installed) {
              throw new Error('Tailscale APK install failed');
            }
          } finally {
            // Always clean up the APK temp file (success and failure paths).
            await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
          }
          mobileLogger.flow('Fleet: Tailscale APK installed', { commandId });
        }

        const ok = await setTailscaleManaged(payload.authKey, payload.hostname, payload.tailnet);
        if (!ok) {
          throw new Error(
            'setTailscaleManaged returned false (module absent or Tailscale not installed)',
          );
        }
        await writeTailscaleAppliedState('up');
        mobileLogger.flow('Fleet: Tailscale up applied', { commandId });
        success = true;
      }
    } else if (action === 'down') {
      if (alreadyApplied === 'down') {
        mobileLogger.flow('Fleet: Tailscale already down — reporting success without native call', {
          commandId,
        });
        success = true;
      } else {
        const ok = await clearTailscaleManaged();
        if (!ok) {
          throw new Error('clearTailscaleManaged returned false (module absent)');
        }
        await writeTailscaleAppliedState('down');
        mobileLogger.flow('Fleet: Tailscale down applied', { commandId });
        success = true;
      }
    } else {
      throw new Error(`Unknown tailscale action: ${String(action)}`);
    }
  } catch (err) {
    // Bug 8: never log the raw error message for tailscale commands — it may
    // contain the authKey if a native exception echoes the Bundle. Log only
    // commandId + action for traceability, use a short error code in the report.
    const errName = err instanceof Error ? err.constructor.name : 'UnknownError';
    errorMsg = errName; // sanitized: no message/payload that could echo authKey
    mobileLogger.warn('Fleet: Tailscale command failed', { commandId, action });
  }

  const report: DeviceCommandReport = {
    commandId,
    status: success ? 'success' : 'failure',
    // Report only the sanitized error name, never the raw message (Bug 8).
    ...(errorMsg && !success ? { error: errorMsg } : {}),
  };
  await appendCommandReport(report);
}

// ---------------------------------------------------------------------------
// Active trip gate
// ---------------------------------------------------------------------------

/**
 * Returns true when there is at least one non-terminal trip in local SQLite.
 * Terminal statuses mirror the server: completed, cancelled.
 * A missing or empty DB is treated as idle (no active trip).
 */
async function hasActiveTrip(): Promise<boolean> {
  try {
    const db = await getDatabase();
    const repo = new TripsRepo(db);
    const active = await repo.listActive();
    return active.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OTA orchestration (Part 3)
// ---------------------------------------------------------------------------

/**
 * Drive one OTA step for the given pending deployment.
 * Called after a successful check-in response.
 */
async function handlePendingDeployment(
  deployment: PendingDeployment,
  activeTripFlag: boolean,
): Promise<void> {
  const currentVersionCode: number =
    Constants.expoConfig?.android?.versionCode ??
    (Constants.expoConfig?.ios?.buildNumber ? Number(Constants.expoConfig.ios.buildNumber) : 0) ??
    0;

  // Already up to date — report installed and clear mirror.
  if (currentVersionCode >= deployment.versionCode) {
    mobileLogger.flow('Fleet OTA: already at target version', {
      current: currentVersionCode,
      target: deployment.versionCode,
    });
    // Flush an `installed` report if there is a mirror for this deployment.
    const existing = await readOtaMirror();
    if (existing && existing.deploymentId === deployment.deploymentId) {
      await appendOtaReport(existing, 'installed' as OtaState);
      await clearOtaMirror();
    }
    return;
  }

  let mirror = await readOtaMirror();

  // New deployment or different deployment — start fresh.
  if (!mirror || mirror.deploymentId !== deployment.deploymentId) {
    mirror = {
      deploymentId: deployment.deploymentId,
      version: deployment.version,
      versionCode: deployment.versionCode,
      sha256: deployment.sha256,
      apkUrl: deployment.apkUrl,
      sizeBytes: deployment.sizeBytes,
      localUri: null,
      state: 'pending' as OtaState,
      attempt: 0,
      reports: [],
    };
    await writeOtaMirror(mirror);
    mobileLogger.flow('Fleet OTA: new deployment tracked', {
      deploymentId: deployment.deploymentId,
    });
  }

  // Hard stop: too many attempts regardless of current state.
  // Gates on attempt count alone so a mirror stuck in awaiting_idle or any
  // other non-failed state with attempt >= MAX cannot retry forever.
  if (mirror.attempt >= MAX_INSTALL_ATTEMPTS) {
    mobileLogger.warn('Fleet OTA: max install attempts reached, giving up', {
      deploymentId: deployment.deploymentId,
      attempt: mirror.attempt,
    });
    // Leave in failed state so the server knows we gave up.
    if (mirror.state !== ('failed' as OtaState)) {
      mirror = await appendOtaReport(mirror, 'failed' as OtaState, 'max attempts exceeded');
    }
    return;
  }

  // Step: Download if not already downloaded.
  if (
    !mirror.localUri ||
    mirror.state === ('pending' as OtaState) ||
    mirror.state === ('notified' as OtaState)
  ) {
    mirror = await appendOtaReport(mirror, 'downloading' as OtaState);
    mobileLogger.flow('Fleet OTA: downloading APK', { apkUrl: deployment.apkUrl });
    try {
      const destUri = `${FileSystem.documentDirectory ?? ''}strawboss-ota-${deployment.deploymentId}.apk`;
      const fullUrl = `${API_URL}${deployment.apkUrl}`;
      const downloadResult = await FileSystem.downloadAsync(fullUrl, destUri);
      if (downloadResult.status !== 200) {
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }
      mirror = { ...mirror, localUri: downloadResult.uri };
      await writeOtaMirror(mirror);
      mirror = await appendOtaReport(mirror, 'downloaded' as OtaState);
      mobileLogger.flow('Fleet OTA: APK downloaded', { localUri: mirror.localUri });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Increment attempt on download failure so repeated failures count toward
      // the MAX_INSTALL_ATTEMPTS cap and the gate above eventually fires.
      mirror = { ...mirror, attempt: mirror.attempt + 1 };
      mirror = await appendOtaReport(mirror, 'failed' as OtaState, msg);
      mobileLogger.warn('Fleet OTA: download failed', {
        error: msg,
        attempt: mirror.attempt,
        deploymentId: deployment.deploymentId,
      });
      return;
    }
  }

  // Step: Idle gate — if mid-trip and not forced, wait.
  if (activeTripFlag && !deployment.installPolicy.forceNow) {
    mirror = await appendOtaReport(mirror, 'awaiting_idle' as OtaState);
    mobileLogger.flow('Fleet OTA: device mid-trip, deferring install', {
      deploymentId: deployment.deploymentId,
    });
    return;
  }

  // Step: Install.
  const localUri = mirror.localUri;
  if (!localUri) {
    // Should not happen — safety guard.
    mobileLogger.warn('Fleet OTA: no localUri available for install');
    return;
  }

  // Persist BEFORE calling installApkSilent — the process will be killed.
  await SecureStore.setItemAsync(PENDING_INSTALL_DEPLOYMENT_ID_KEY, deployment.deploymentId);

  mirror = { ...mirror, attempt: mirror.attempt + 1 };
  mirror = await appendOtaReport(mirror, 'installing' as OtaState);
  mobileLogger.flow('Fleet OTA: installing APK', {
    localUri,
    attempt: mirror.attempt,
    deploymentId: deployment.deploymentId,
  });

  try {
    const ok = await installApkSilent(localUri, deployment.sha256, 'com.strawboss.mobile');
    if (!ok) {
      throw new Error('installApkSilent returned false');
    }
    // If we somehow survive (unlikely for self-update), mark success.
    mirror = await appendOtaReport(mirror, 'installed' as OtaState);
    await clearOtaMirror();
    await SecureStore.deleteItemAsync(PENDING_INSTALL_DEPLOYMENT_ID_KEY);
    mobileLogger.flow('Fleet OTA: install completed (process survived)', {
      deploymentId: deployment.deploymentId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mirror = await appendOtaReport(mirror, 'failed' as OtaState, msg);
    await writeOtaMirror(mirror);
    // Clear the pending-install key on failure since we're not reinstalling.
    await SecureStore.deleteItemAsync(PENDING_INSTALL_DEPLOYMENT_ID_KEY);
    mobileLogger.warn('Fleet OTA: install failed', {
      error: msg,
      attempt: mirror.attempt,
      deploymentId: deployment.deploymentId,
    });
  }
}

// ---------------------------------------------------------------------------
// Main check-in (Part 2)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// In-flight mutex — prevents concurrent check-in calls from racing
// ---------------------------------------------------------------------------

/**
 * At most one runDeviceCheckin() executes at a time. Concurrent callers await
 * the same in-flight promise rather than creating a second concurrent cycle.
 * This prevents:
 *   - clearCommandReports() wiping reports appended by a sibling call.
 *   - Two parallel ensureDeviceId() calls generating two device UUIDs on first run.
 */
let checkinInFlight: Promise<void> | null = null;

/**
 * Run one fleet check-in cycle:
 *   1. Gather device identity + hardware info + push token + trip state.
 *   2. POST /api/v1/fleet/checkin (unauthenticated).
 *   3. Persist deviceToken if issued.
 *   4. Handle any pendingDeployment via the OTA orchestrator.
 *
 * Fire-and-forget: errors are logged but never thrown.
 * Concurrent callers share the same in-flight promise — only one cycle runs at a time.
 */
export function runDeviceCheckin(): Promise<void> {
  if (checkinInFlight) return checkinInFlight;
  checkinInFlight = (async () => {
    try {
      const { deviceUuid, deviceToken } = await ensureDeviceId();

      // App version
      const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';
      const versionCode: number =
        Constants.expoConfig?.android?.versionCode ??
        (Constants.expoConfig?.ios?.buildNumber
          ? Number(Constants.expoConfig.ios.buildNumber)
          : 0) ??
        0;

      // Hardware info — best effort
      const hwInfo = await getDeviceHardwareInfo();

      // Raw FCM push token — best effort (may throw in dev without Firebase)
      let pushToken: string | undefined;
      try {
        const devicePushToken = await Notifications.getDevicePushTokenAsync();
        if (typeof devicePushToken.data === 'string' && devicePushToken.data) {
          pushToken = devicePushToken.data;
        }
      } catch {
        // Not critical — the Expo push token is used for notifications, raw FCM
        // token for device-keyed check-in acceleration push. If unavailable, skip.
      }

      // Device owner flag
      const ownerFlag = await isDeviceOwner();

      // Active trip flag
      const activeTripFlag = await hasActiveTrip();

      // Accumulate pending OTA reports from the local mirror
      const mirror = await readOtaMirror();
      const otaReports: DeviceOtaReport[] = mirror?.reports?.length ? mirror.reports : [];

      // Accumulate pending command reports (e.g. Tailscale up/down outcomes)
      const commandReports = await readCommandReports();

      const body: DeviceCheckinRequest = {
        deviceUuid,
        ...(deviceToken ? { deviceToken } : {}),
        appVersion,
        versionCode,
        ...(hwInfo.model !== undefined ? { model: hwInfo.model } : {}),
        ...(hwInfo.manufacturer !== undefined ? { manufacturer: hwInfo.manufacturer } : {}),
        ...(hwInfo.osVersion !== undefined ? { osVersion: hwInfo.osVersion } : {}),
        ...(hwInfo.androidId !== undefined ? { androidId: hwInfo.androidId } : {}),
        ...(pushToken !== undefined ? { pushToken } : {}),
        isDeviceOwner: ownerFlag,
        activeTrip: activeTripFlag,
        ...(otaReports.length > 0 ? { otaReports } : {}),
        ...(commandReports.length > 0 ? { commandReports } : {}),
      };

      mobileLogger.flow('Fleet: check-in start', { deviceUuid, appVersion, versionCode });

      const response = await fleetApiClient.post<DeviceCheckinResponse>(
        '/api/v1/fleet/checkin',
        body,
      );

      // Persist a newly issued device token
      if (response.deviceTokenIssued) {
        await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, response.deviceTokenIssued);
        mobileLogger.flow('Fleet: device token persisted');
      }

      // Clear sent OTA reports from mirror now that they were delivered
      if (mirror && otaReports.length > 0) {
        const updatedMirror: OtaMirror = { ...mirror, reports: [] };
        await writeOtaMirror(updatedMirror);
      }

      // Clear sent command reports now that they were delivered
      if (commandReports.length > 0) {
        await clearCommandReports();
      }

      mobileLogger.flow('Fleet: check-in ok', {
        deviceId: response.deviceId,
        assignedOrgId: response.assignedOrgId,
        hasPendingDeployment: !!response.pendingDeployment,
        hasPendingCommand: !!response.pendingCommand,
      });

      // Handle OTA deployment if one is pending
      if (response.pendingDeployment) {
        await handlePendingDeployment(response.pendingDeployment, activeTripFlag);
      }

      // Handle remote command if one is pending (currently: Tailscale up/down)
      if (response.pendingCommand?.type === 'tailscale') {
        await handleTailscaleCommand(response.pendingCommand);
      }
    } catch (err) {
      // Check-in is fire-and-forget — log at warn but never propagate.
      mobileLogger.warn('Fleet: check-in failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })().finally(() => {
    checkinInFlight = null;
  });
  return checkinInFlight;
}

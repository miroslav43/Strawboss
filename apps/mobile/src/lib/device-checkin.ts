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
  DeviceOtaReport,
  OtaState,
  PendingDeployment,
} from '@strawboss/types';
import { generateUuid } from './uuid';
import { isDeviceOwner, getDeviceHardwareInfo, installApkSilent } from './device-owner';
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

  // Hard stop: too many failed install attempts.
  if (mirror.attempt >= MAX_INSTALL_ATTEMPTS && mirror.state === ('failed' as OtaState)) {
    mobileLogger.warn('Fleet OTA: max install attempts reached, giving up', {
      deploymentId: deployment.deploymentId,
      attempt: mirror.attempt,
    });
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
      mirror = await appendOtaReport(mirror, 'failed' as OtaState, msg);
      mobileLogger.warn('Fleet OTA: download failed', { error: msg });
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
    const ok = await installApkSilent(localUri, deployment.sha256);
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

/**
 * Run one fleet check-in cycle:
 *   1. Gather device identity + hardware info + push token + trip state.
 *   2. POST /api/v1/fleet/checkin (unauthenticated).
 *   3. Persist deviceToken if issued.
 *   4. Handle any pendingDeployment via the OTA orchestrator.
 *
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function runDeviceCheckin(): Promise<void> {
  try {
    const { deviceUuid, deviceToken } = await ensureDeviceId();

    // App version
    const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';
    const versionCode: number =
      Constants.expoConfig?.android?.versionCode ??
      (Constants.expoConfig?.ios?.buildNumber ? Number(Constants.expoConfig.ios.buildNumber) : 0) ??
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

    // Clear sent reports from mirror now that they were delivered
    if (mirror && otaReports.length > 0) {
      const updatedMirror: OtaMirror = { ...mirror, reports: [] };
      await writeOtaMirror(updatedMirror);
    }

    mobileLogger.flow('Fleet: check-in ok', {
      deviceId: response.deviceId,
      assignedOrgId: response.assignedOrgId,
      hasPendingDeployment: !!response.pendingDeployment,
    });

    // Handle OTA deployment if one is pending
    if (response.pendingDeployment) {
      await handlePendingDeployment(response.pendingDeployment, activeTripFlag);
    }
  } catch (err) {
    // Check-in is fire-and-forget — log at warn but never propagate.
    mobileLogger.warn('Fleet: check-in failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

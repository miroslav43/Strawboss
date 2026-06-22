import type { Timestamps, SoftDelete } from '../common.js';

/**
 * Fleet management + OTA self-update.
 *
 * Every install of the mobile app registers itself as a `Device` (even before any
 * user logs in / before it is assigned to an organization). A super-admin uploads an
 * `AppRelease` (a signed APK), then creates an `OtaDeployment` targeting some devices;
 * each targeted device gets a `DeviceOtaStatus` row that tracks the per-device update
 * state machine. Devices are server-authoritative (NOT mobile-synced) and pull work by
 * polling `POST /api/v1/fleet/checkin`.
 */

/** Per-device update lifecycle. The DEVICE drives forward transitions; the backend only
 * sets pending→notified and confirms `installed` on versionCode proof. */
export enum OtaState {
  pending = 'pending',
  notified = 'notified',
  downloading = 'downloading',
  downloaded = 'downloaded',
  /** Verified APK on disk, but the device is mid-trip and forceNow is false. */
  awaiting_idle = 'awaiting_idle',
  installing = 'installing',
  installed = 'installed',
  failed = 'failed',
}

export enum OtaDeploymentStatus {
  pending = 'pending',
  active = 'active',
  completed = 'completed',
  cancelled = 'cancelled',
}

export enum ReleaseStatus {
  draft = 'draft',
  published = 'published',
  archived = 'archived',
}

export enum OtaTargetKind {
  all = 'all',
  org = 'org',
  device_set = 'device_set',
}

/** A registered device. `deviceUuid` (SecureStore-persisted UUID) is the real identity;
 * `organizationId` is null until a super-admin assigns it. `deviceTokenHash` is server-only. */
export interface Device extends Timestamps, SoftDelete {
  id: string;
  deviceUuid: string;
  organizationId: string | null;
  /** Super-admin editable display label. */
  name: string | null;
  androidId: string | null;
  model: string | null;
  manufacturer: string | null;
  osVersion: string | null;
  /** versionName, e.g. "1.0.2". */
  appVersion: string | null;
  /** expo.android.versionCode — monotonic; used for downgrade/skew checks. */
  versionCode: number | null;
  /** Raw FCM device token (for the device-keyed acceleration push). */
  pushToken: string | null;
  isDeviceOwner: boolean;
  lastSeenAt: string | null;
  lastCheckinAt: string | null;
  /** Last reported idle gate — true if the device was mid-trip at last check-in. */
  lastActiveTrip: boolean;
  // ── Tailscale (remote access for debugging) ──
  /** Desired state set by super-admin; the device applies it via MDM on next check-in. */
  tailscaleDesired: boolean;
  /** Whether the peer is currently online in the VM's tailnet (set by the host status sync). */
  tailscaleOnline: boolean;
  /** The device's 100.x tailnet IP (from `tailscale status`). */
  tailscaleIp: string | null;
  /** The sanitized nickname used as the Tailscale hostname. */
  tailscaleHostname: string | null;
  tailscaleLastSeen: string | null;
  /** Best-effort reason the last tailscale command failed (device-reported). */
  tailscaleLastError: string | null;
  /** Latest device-reported state snapshot (from a `report_state` remote command). */
  lastState: DeviceState | null;
  lastStateAt: string | null;
}

/** A device-reported diagnostic snapshot (gathered by the `report_state` remote command). */
export interface DeviceState {
  batteryPct: number | null;
  isCharging: boolean | null;
  isDeviceOwner: boolean;
  tailscaleInstalled: boolean;
  installedPackageCount: number | null;
  appVersion: string | null;
  grantedPermissions: string[];
}

/** Singleton global config the super-admin edits (e.g. the Tailscale auth key).
 * Secrets are NEVER returned raw — the API exposes only `*Set` booleans. */
export interface AppSettings {
  /** Whether a shared auth key is configured (raw value never returned). */
  tailscaleAuthKeySet: boolean;
  tailscaleTailnet: string | null;
  /** Whether a Tailscale OAuth client is configured (enables per-device ephemeral keys). */
  tailscaleOauthConfigured: boolean;
  /** Tag applied to OAuth-minted keys (e.g. 'tag:fleet-phone'). Required for OAuth minting. */
  tailscaleTag: string | null;
  /** Whether a Tailscale APK is hosted for zero-touch auto-install on phones. */
  tailscaleApkSet: boolean;
  updatedAt: string | null;
}

/** A device list row enriched with joins the UI needs (org name + latest OTA state). */
export interface FleetDeviceListItem extends Device {
  organizationName: string | null;
  latestOtaState: OtaState | null;
  latestDeploymentId: string | null;
}

/** An uploaded APK. */
export interface AppRelease extends Timestamps, SoftDelete {
  id: string;
  version: string;
  versionCode: number;
  /** Storage key under UPLOADS_ROOT, e.g. "apks/<id>.apk". */
  apkKey: string;
  /** Hex SHA-256 digest, verified on device before install. */
  sha256: string;
  sizeBytes: number;
  changelog: string | null;
  mandatory: boolean;
  status: ReleaseStatus;
  uploadedBy: string | null;
}

/** A push/schedule of one release to a set of devices. */
export interface OtaDeployment extends Timestamps {
  id: string;
  releaseId: string;
  targetKind: OtaTargetKind;
  targetOrgId: string | null;
  targetDeviceIds: string[] | null;
  /** null = immediate; otherwise the BullMQ-delayed activation time (ISO). */
  scheduledAt: string | null;
  /** Bypass the device idle gate (install even mid-trip). */
  forceNow: boolean;
  status: OtaDeploymentStatus;
  createdBy: string | null;
}

/** The per-device state-machine instance for one deployment. */
export interface DeviceOtaStatus {
  id: string;
  deploymentId: string;
  deviceId: string;
  state: OtaState;
  error: string | null;
  attempt: number;
  notifiedAt: string | null;
  downloadedAt: string | null;
  installedAt: string | null;
  updatedAt: string;
}

// ── Check-in protocol (device ⇄ backend) ─────────────────────────────────────

/** A device-driven OTA transition, reported on check-in. */
export interface DeviceOtaReport {
  deploymentId: string;
  state: OtaState;
  error?: string;
}

/** A one-shot remote command the backend hands a device on check-in (currently Tailscale
 * up/down for remote ADB access). The device applies it via the Device-Owner MDM controls
 * and reports the result in `commandReports[]` on its next check-in. */
export interface DeviceCommand {
  /** Idempotency id; the device echoes it back in its report. */
  id: string;
  type: 'tailscale';
  action: 'up' | 'down';
  /** Present for `up`: what the device pushes into the Tailscale app's managed config. */
  payload?: {
    authKey: string;
    hostname: string;
    tailnet: string;
    /** If set and the Tailscale app isn't installed, the device silently installs this APK
     * (signed URL + sha256) before configuring Tailscale. */
    tailscaleApk?: {
      url: string;
      sha256: string;
    };
  };
}

/** Result of applying a `DeviceCommand`, reported on the next check-in. */
export interface DeviceCommandReport {
  commandId: string;
  status: 'success' | 'failure';
  error?: string;
}

// ── Tier-1 one-shot remote-debug command queue (separate from the Tailscale channel) ─────

export type RemoteCommandType = 'reboot' | 'fetch_logs' | 'reinstall_apk' | 'report_state';
export type RemoteCommandStatus = 'pending' | 'sent' | 'completed' | 'failed';

/** A one-shot management/diagnostic command handed to a device on check-in. */
export interface DeviceRemoteCommand {
  id: string;
  type: RemoteCommandType;
  /** Type-specific params: reinstall_apk → {packageName,apkUrl,sha256}; fetch_logs → {date?}. */
  params?: Record<string, unknown>;
}

/** Device → backend result for a one-shot command. */
export interface DeviceRemoteCommandReport {
  commandId: string;
  status: 'success' | 'failure';
  /** For report_state, the gathered DeviceState; other commands may return small info. */
  result?: Record<string, unknown>;
  error?: string;
}

/** A row of the one-shot command history (super-admin view). */
export interface DeviceRemoteCommandRecord extends Timestamps {
  id: string;
  deviceId: string;
  type: RemoteCommandType;
  params: Record<string, unknown> | null;
  status: RemoteCommandStatus;
  result: Record<string, unknown> | null;
  lastError: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
}

/** Device → backend. Public endpoint; `deviceToken` proves identity after the first
 * (registration) check-in, which omits it and receives `deviceTokenIssued` once. */
export interface DeviceCheckinRequest {
  deviceUuid: string;
  deviceToken?: string;
  appVersion: string;
  versionCode: number;
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  androidId?: string;
  pushToken?: string;
  isDeviceOwner: boolean;
  activeTrip: boolean;
  otaReports?: DeviceOtaReport[];
  /** Results of remote commands (e.g. Tailscale up/down) applied since the last check-in. */
  commandReports?: DeviceCommandReport[];
  /** Results of one-shot remote-debug commands (reboot/fetch_logs/reinstall_apk/report_state). */
  remoteCommandReports?: DeviceRemoteCommandReport[];
  lastError?: string;
}

/** The signed APK + install policy handed to a device that has pending work. */
export interface PendingDeployment {
  deploymentId: string;
  releaseId: string;
  version: string;
  versionCode: number;
  /** Signed, time-limited download URL (consumed with a plain GET). */
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  installPolicy: {
    forceNow: boolean;
    mandatory: boolean;
  };
}

/** Backend → device. */
export interface DeviceCheckinResponse {
  deviceId: string;
  assignedOrgId: string | null;
  /** Present ONLY on the first (registration) response — the raw HMAC token to persist. */
  deviceTokenIssued?: string;
  pendingDeployment: PendingDeployment | null;
  /** A remote command to apply now (Tailscale up/down), or null. */
  pendingCommand: DeviceCommand | null;
  /** One-shot remote-debug commands to run now (deduped on the device by id). */
  pendingCommands: DeviceRemoteCommand[];
}

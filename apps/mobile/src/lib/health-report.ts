/**
 * gatherHealthReport() — comprehensive on-device self-diagnostic returned as the
 * `result` of the `report_state` remote command and rendered by the super-admin
 * "Device Health" panel. Lets us diagnose why a phone is offline / misbehaving
 * WITHOUT adb (login state, presence alarm liveness, check-in/sync freshness,
 * battery-opt, Tailscale policy, OTA, connectivity, …).
 *
 * Every probe runs through `run()` which catches its own errors, records the
 * probe name in `gatherErrors`, and returns a fallback — so the report itself
 * never throws and a single broken probe never blanks the rest.
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import type { DeviceHealthReport } from '@strawboss/types';
import { useAuthStore } from '../stores/auth-store';
import { getAuthToken, getSupabaseClient } from './auth';
import {
  getDeviceState,
  getDeviceHardwareInfo,
  getNativeHealthExtras,
  isDeviceOwner,
} from './device-owner';
import { readHealthTimestamps } from './health-state';
import { getLocationHealthSnapshot } from './location';
import { getDatabase } from './storage';
import { SyncQueueRepo } from '../db/sync-queue-repo';

// SecureStore keys owned by device-checkin.ts — read directly here to avoid a
// static import cycle (health-report ← device-checkin). Keep in sync with that file.
const OTA_MIRROR_KEY = 'strawboss.ota_mirror';
const TAILSCALE_APPLIED_STATE_KEY = 'strawboss.tailscale_state';

/** When this JS runtime/bundle loaded — a proxy for "how long has JS been alive". */
const JS_START_MS = Date.now();

function epochToIso(ms: unknown): string | null {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}
const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Android UsageStatsManager bucket codes → human label. */
function standbyBucketLabel(b: number | null): string | null {
  switch (b) {
    case 5:
      return 'exempt';
    case 10:
      return 'active';
    case 20:
      return 'working_set';
    case 30:
      return 'frequent';
    case 40:
      return 'rare';
    case 45:
      return 'restricted';
    default:
      return b == null ? null : `bucket_${b}`;
  }
}

export async function gatherHealthReport(): Promise<DeviceHealthReport> {
  const gatherErrors: string[] = [];
  async function run<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      gatherErrors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  }

  // ── Auth / session (supabase session is reliable even headless; role best-effort) ──
  const auth = await run(
    'auth',
    async () => {
      const token = await getAuthToken();
      const { data } = await getSupabaseClient().auth.getSession();
      const session = data.session;
      const store = useAuthStore.getState();
      return {
        isAuthenticated: !!token,
        userId: session?.user?.id ?? store.userId ?? null,
        role: store.role ?? null,
        sessionExpiresAt: session?.expires_at
          ? new Date(session.expires_at * 1000).toISOString()
          : null,
      };
    },
    { isAuthenticated: false, userId: null, role: null, sessionExpiresAt: null },
  );

  // ── Native extras (presence service/alarm, battery-opt, standby, tailscale policy) ──
  const nx = await run(
    'nativeExtras',
    () => getNativeHealthExtras(),
    {} as Record<string, unknown>,
  );

  // ── Device state + hardware ──
  const ds = await run('deviceState', () => getDeviceState(), {} as Record<string, unknown>);
  const hw = await run('hardware', () => getDeviceHardwareInfo(), {} as Record<string, string>);
  const owner = await run('isDeviceOwner', () => isDeviceOwner(), false);

  // ── Freshness timestamps + location + sync queue ──
  const ts = await run('timestamps', () => readHealthTimestamps(), {
    lastCheckinAt: null,
    lastHeartbeatAt: null,
    lastSyncAt: null,
    lastSyncError: null,
  });
  const loc = await run('location', () => getLocationHealthSnapshot(), {
    assignedMachineId: null as string | null,
    backgroundTrackingActive: false,
    lastLocationReportAt: null as string | null,
    lastSpeedKmh: null as number | null,
    lastProfile: null as string | null,
    pendingLocationReports: 0,
  });
  const perms = await run(
    'locationPerms',
    async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      return { fg: fg.status as string | null, bg: bg.status as string | null };
    },
    { fg: null, bg: null },
  );
  const syncQueueDepth = await run<number | null>(
    'syncQueue',
    async () => new SyncQueueRepo(await getDatabase()).getPendingCount(),
    null,
  );

  // ── OTA mirror + Tailscale applied-state (read directly from SecureStore) ──
  const ota = await run(
    'ota',
    async () => {
      const raw = await SecureStore.getItemAsync(OTA_MIRROR_KEY);
      if (!raw) return { state: null, deploymentId: null, attempt: null };
      const m = JSON.parse(raw) as { state?: string; deploymentId?: string; attempt?: number };
      return {
        state: m.state ?? null,
        deploymentId: m.deploymentId ?? null,
        attempt: typeof m.attempt === 'number' ? m.attempt : null,
      };
    },
    {
      state: null as string | null,
      deploymentId: null as string | null,
      attempt: null as number | null,
    },
  );
  const tsApplied = await run<'up' | 'down' | null>(
    'tailscaleApplied',
    async () => {
      const raw = await SecureStore.getItemAsync(TAILSCALE_APPLIED_STATE_KEY);
      return raw === 'up' || raw === 'down' ? raw : null;
    },
    null,
  );

  // ── Connectivity ──
  const net = await run(
    'net',
    async () => {
      const s = await NetInfo.fetch();
      return { online: s.isConnected ?? null, networkType: (s.type as string) ?? null };
    },
    { online: null as boolean | null, networkType: null as string | null },
  );

  // ── Push token + notification permission ──
  const notif = await run(
    'notifications',
    async () => {
      let pushTokenPresent = false;
      try {
        const t = await Notifications.getDevicePushTokenAsync();
        pushTokenPresent = typeof t.data === 'string' && !!t.data;
      } catch {
        // getDevicePushTokenAsync throws without Firebase — leave false.
      }
      const perm = await Notifications.getPermissionsAsync();
      return { pushTokenPresent, notificationPermission: perm.status as string | null };
    },
    { pushTokenPresent: false, notificationPermission: null },
  );

  const standbyBucket = numOrNull(nx.standbyBucket);
  const hasAlarmKey = 'presenceAlarmNextFireAt' in nx;

  return {
    reportAt: new Date().toISOString(),
    appUptimeMs: Date.now() - JS_START_MS,

    appVersion: Constants.expoConfig?.version ?? null,
    versionCode: Constants.expoConfig?.android?.versionCode ?? null,
    buildProfile: __DEV__ ? 'debug' : 'release',

    isAuthenticated: auth.isAuthenticated,
    userId: auth.userId,
    role: auth.role,
    sessionExpiresAt: auth.sessionExpiresAt,

    isDeviceOwner: owner || boolOrNull(ds.isDeviceOwner) === true,
    batteryOptIgnored: boolOrNull(nx.batteryOptIgnored),
    standbyBucket,
    standbyBucketLabel: standbyBucketLabel(standbyBucket),
    oemPowerPackages: Array.isArray(nx.oemPowerPackages)
      ? (nx.oemPowerPackages as DeviceHealthReport['oemPowerPackages'])
      : null,

    presenceServiceRunning: boolOrNull(nx.presenceServiceRunning),
    presenceAlarmScheduled: hasAlarmKey ? nx.presenceAlarmNextFireAt != null : null,
    presenceAlarmNextFireAt: epochToIso(nx.presenceAlarmNextFireAt),
    presenceAlarmLastFireAt: epochToIso(nx.presenceAlarmLastFireAt),
    backgroundTrackingActive: boolOrNull(loc.backgroundTrackingActive),

    lastCheckinAt: ts.lastCheckinAt,
    lastHeartbeatAt: ts.lastHeartbeatAt,
    lastSyncAt: ts.lastSyncAt,
    lastSyncError: ts.lastSyncError,
    syncQueueDepth,
    pendingLocationReports: numOrNull(loc.pendingLocationReports),

    assignedMachineId: loc.assignedMachineId,
    lastLocationReportAt: loc.lastLocationReportAt,
    fgLocationPermission: perms.fg,
    bgLocationPermission: perms.bg,
    lastSpeedKmh: numOrNull(loc.lastSpeedKmh),
    lastProfile: strOrNull(loc.lastProfile),

    tailscaleInstalled: boolOrNull(ds.tailscaleInstalled),
    tailscaleAppliedState: tsApplied,
    tailscaleHidden: boolOrNull(nx.tailscaleHidden),
    alwaysOnVpnPackage: strOrNull(nx.alwaysOnVpnPackage),

    otaMirrorState: ota.state,
    otaMirrorDeploymentId: ota.deploymentId,
    otaMirrorAttempt: ota.attempt,

    online: net.online,
    networkType: net.networkType,
    batteryPct: numOrNull(ds.batteryPct),
    isCharging: boolOrNull(ds.isCharging),
    freeStorageBytes: numOrNull(nx.freeStorageBytes),
    model: strOrNull(hw.model),
    manufacturer: strOrNull(hw.manufacturer),
    osVersion: strOrNull(hw.osVersion),
    androidId: strOrNull(hw.androidId),

    pushTokenPresent: notif.pushTokenPresent,
    notificationPermission: notif.notificationPermission,

    gatherErrors,
  };
}

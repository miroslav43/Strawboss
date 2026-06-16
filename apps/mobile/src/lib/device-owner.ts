/**
 * Typed JS wrapper over the native `DeviceOwner` module (plugins/withDeviceOwner.js).
 *
 * On the ~30 dedicated phones provisioned as Device Owner this exposes:
 *   - isDeviceOwner()            — are we the device owner? (memoized per process)
 *   - applyDeviceOwnerPolicies() — idempotently re-assert all policies
 *   - launchAlertActivityOverEverything() — pop the alert over ANY app + lockscreen
 *   - releaseDeviceOwner()       — decommission valve (relinquish ownership)
 *   - canUseFullScreenIntent() / presentFullScreenAlert() — non-device-owner fallback
 *
 * The native module is Android-only and absent in Expo Go / iOS — every call is
 * defensively guarded so JS never throws when it's missing.
 */
import { NativeModules, Platform } from 'react-native';
import { mobileLogger } from './logger';

interface DeviceOwnerNative {
  isDeviceOwner(): Promise<boolean>;
  applyDeviceOwnerPolicies(): Promise<boolean>;
  releaseDeviceOwner(): Promise<boolean>;
  launchAlertActivityOverEverything(deepLink: string): Promise<boolean>;
  canUseFullScreenIntent(): Promise<boolean>;
  presentFullScreenAlert(title: string, body: string, deepLink: string): Promise<boolean>;
}

const native: DeviceOwnerNative | null =
  Platform.OS === 'android'
    ? (((NativeModules as Record<string, unknown>).DeviceOwner as DeviceOwnerNative | undefined) ??
      null)
    : null;

/**
 * Device-owner status is fixed for the life of the process, so we memoize it.
 * The background GPS task calls this every ~10–30 s — it must not pay a bridge
 * round-trip each time.
 */
let deviceOwnerCache: Promise<boolean> | null = null;

export function isDeviceOwner(): Promise<boolean> {
  if (!deviceOwnerCache) {
    deviceOwnerCache = (async () => {
      if (!native) return false;
      try {
        return await native.isDeviceOwner();
      } catch {
        return false;
      }
    })();
  }
  return deviceOwnerCache;
}

/** Idempotently re-assert all device-owner policies. No-op when not device owner. */
export async function applyDeviceOwnerPolicies(): Promise<void> {
  if (!native) return;
  try {
    const ok = await native.applyDeviceOwnerPolicies();
    mobileLogger.flow('Device owner policies applied (JS)', { isOwner: ok });
  } catch (err) {
    mobileLogger.warn('applyDeviceOwnerPolicies failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Device-owner path: launch the alert activity over whatever is on screen
 * (foreground app or lock screen). Returns false when not available so callers
 * can fall back to the full-screen-intent notification.
 */
export async function launchAlertActivityOverEverything(
  deepLink = 'strawboss://',
): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.launchAlertActivityOverEverything(deepLink);
  } catch (err) {
    mobileLogger.warn('launchAlertActivityOverEverything failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Non-device-owner fallback gate (Android 14+). */
export async function canUseFullScreenIntent(): Promise<boolean> {
  if (!native) return true;
  try {
    return await native.canUseFullScreenIntent();
  } catch {
    return true;
  }
}

/** Non-device-owner fallback: full-screen-intent notification that wakes the screen. */
export async function presentFullScreenAlert(
  title: string,
  body: string,
  deepLink = 'strawboss://',
): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.presentFullScreenAlert(title, body, deepLink);
  } catch (err) {
    mobileLogger.warn('presentFullScreenAlert failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Decommission valve — relinquish device ownership so the phone can be wiped of
 * StrawBoss control without a factory reset. Admin-gated by callers.
 */
export async function releaseDeviceOwner(): Promise<boolean> {
  if (!native) return false;
  try {
    const ok = await native.releaseDeviceOwner();
    mobileLogger.flow('Device owner released', { ok });
    // Ownership changed — invalidate the memoized result.
    deviceOwnerCache = null;
    return ok;
  } catch (err) {
    mobileLogger.warn('releaseDeviceOwner failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

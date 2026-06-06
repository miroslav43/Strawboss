/**
 * One-time, per-device Android setup helpers for reliable always-on tracking.
 *
 * Two things cannot be granted programmatically without Device Owner — we can
 * only deep-link the user to the right screen:
 *   1. Battery-optimization exemption (Doze allowlist). Having this also makes
 *      the post-reboot foreground-service start far more reliable (it is itself
 *      a documented background-FGS-start exemption).
 *   2. OEM "autostart" / background-launch whitelisting (MIUI/EMUI/ColorOS/etc.)
 *      — required on aggressive ROMs for the BootReceiver to fire and for the
 *      service to survive.
 *
 * Surfaced by `app/tracking-setup.tsx`.
 */
import { Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import { mobileLogger } from './logger';

/** Must match `android.package` in app.json. */
const APP_PACKAGE = 'com.strawboss.mobile';

/** Lowercased device manufacturer (Android), e.g. "xiaomi", "samsung". */
function manufacturer(): string {
  const c = Platform.constants as unknown as { Manufacturer?: string } | undefined;
  return (c?.Manufacturer ?? '').toLowerCase();
}

/**
 * True when the OS battery optimizer is STILL active for us (i.e. NOT exempt).
 * Returns false on iOS / when undeterminable so the UI doesn't nag pointlessly.
 */
export async function isBatteryOptimizationActive(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/**
 * Open the system dialog to request exclusion from battery optimization. Falls
 * back to the battery-optimization list screen, then to the app details page.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${APP_PACKAGE}` },
    );
    return;
  } catch {
    /* fall through to the list screen */
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
    );
    return;
  } catch {
    /* fall through to app details */
  }
  await openAppDetailsSettings();
}

/** Open this app's system "App info" page (universal fallback). */
export async function openAppDetailsSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PACKAGE}` },
    );
  } catch (err) {
    mobileLogger.warn('openAppDetailsSettings failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Known OEM autostart / background-management screens, by manufacturer. Each
 * entry is tried in order (component names drift across ROM versions). Sourced
 * from the widely used AutoStarter component list.
 */
const OEM_AUTOSTART_TARGETS: Record<string, { packageName: string; className: string }[]> = {
  xiaomi: [
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    },
  ],
  redmi: [
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    },
  ],
  poco: [
    {
      packageName: 'com.miui.securitycenter',
      className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
    },
  ],
  huawei: [
    {
      packageName: 'com.huawei.systemmanager',
      className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
    },
    {
      packageName: 'com.huawei.systemmanager',
      className: 'com.huawei.systemmanager.optimize.process.ProtectActivity',
    },
  ],
  honor: [
    {
      packageName: 'com.huawei.systemmanager',
      className: 'com.huawei.systemmanager.optimize.process.ProtectActivity',
    },
  ],
  oppo: [
    {
      packageName: 'com.coloros.safecenter',
      className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
    },
    {
      packageName: 'com.oppo.safe',
      className: 'com.oppo.safe.permission.startup.StartupAppListActivity',
    },
  ],
  realme: [
    {
      packageName: 'com.coloros.safecenter',
      className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity',
    },
  ],
  vivo: [
    {
      packageName: 'com.iqoo.secure',
      className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity',
    },
    {
      packageName: 'com.vivo.permissionmanager',
      className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
    },
  ],
  samsung: [
    {
      packageName: 'com.samsung.android.lool',
      className: 'com.samsung.android.sm.ui.battery.BatteryActivity',
    },
  ],
  oneplus: [
    {
      packageName: 'com.oneplus.security',
      className: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity',
    },
  ],
  asus: [
    {
      packageName: 'com.asus.mobilemanager',
      className: 'com.asus.mobilemanager.autostart.AutoStartActivity',
    },
  ],
};

function autostartTargets(): { packageName: string; className: string }[] {
  const m = manufacturer();
  for (const key of Object.keys(OEM_AUTOSTART_TARGETS)) {
    if (m.includes(key)) return OEM_AUTOSTART_TARGETS[key]!;
  }
  return [];
}

/** Whether the current device is a known aggressive OEM with an autostart screen. */
export function hasOemAutostartScreen(): boolean {
  return Platform.OS === 'android' && autostartTargets().length > 0;
}

/**
 * Open the OEM autostart / background-management screen. Tries each known
 * component for the manufacturer, then falls back to the app details page.
 * @returns true if an OEM-specific screen was opened, false if only the fallback.
 */
export async function openOemAutostartSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const target of autostartTargets()) {
    try {
      await IntentLauncher.startActivityAsync('', {
        packageName: target.packageName,
        className: target.className,
      });
      return true;
    } catch {
      /* try next candidate */
    }
  }
  await openAppDetailsSettings();
  return false;
}

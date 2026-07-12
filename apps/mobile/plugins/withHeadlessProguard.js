/**
 * Expo config plugin: keep Expo's headless JS app-loader out of R8's jaws.
 *
 * THE BUG THIS FIXES (2026-07-12, found on the fleet):
 * Release builds run R8 (`app/build.gradle`: `enableMinifyInReleaseBuilds` defaults
 * to TRUE and is never overridden). Expo's headless app loader is resolved ONLY
 * through reflection —
 *
 *     Class.forName("expo.modules.adapters.react.apploader.RNHeadlessAppLoader")
 *
 * — from `expo.modules.apploader.AppLoaderProvider`. R8 therefore sees ZERO static
 * references to it and deletes the whole subsystem. Proof from a shipped vc43 APK
 * (`android/app/build/outputs/mapping/release/usage.txt`, i.e. R8's own list of
 * REMOVED code):
 *
 *     expo.modules.adapters.react.apploader.RNHeadlessAppLoader
 *     expo.modules.adapters.react.apploader.RNHeadlessAppLoader$loadApp$1
 *     expo.modules.adapters.react.apploader.RNHeadlessAppLoaderKt
 *     expo.modules.adapters.react.apploader.HeadlessAppLoaderNotifier
 *     expo.modules.apploader.AppLoaderProvider$Callback
 *
 * (absent from mapping.txt too => removed, not merely renamed.)
 *
 * WHY IT IS FATAL FOR THE FLEET: a headless JS runtime is what every background
 * entry point needs in order to run ANY JavaScript when no Activity exists —
 * `boot-rearm` after an OTA/reboot, the presence-alarm check-in, expo-background-task
 * sync, and the backend's FCM presence dead-man wake. With the loader stripped, the
 * device logs
 *
 *     E Expo: Cannot initialize app loader.
 *     java.lang.ClassNotFoundException: ...apploader.RNHeadlessAppLoader
 *     WM-WorkerWrapper: java.util.concurrent.CancellationException: Task was cancelled.
 *
 * and the phone becomes a ZOMBIE: the NATIVE half stays perfectly healthy
 * (PresenceService FGS up, battery-opt exempt, standby bucket EXEMPT, WorkManager
 * "Task successfully finished") while NO JavaScript ever runs, so `runDeviceCheckin()`
 * is never called and not a single HTTP request leaves the phone. Observed on Xcover1:
 * 6.2h with zero check-ins; it only recovered when the UI was opened by hand (which
 * boots JS the normal, non-headless way). Under bridgeless Expo the ReactHost is
 * retained, so JS survives while the process lives — which is why phones look fine for
 * hours and then silently go dark for good once the JS runtime is gone. There was NO
 * path back. See .claude docs + FLEET-BACKGROUND-ONLINE.md.
 *
 * THE FIX: -keep the two apploader packages. Deliberately SURGICAL — R8 also strips a
 * lot of `expo.modules.adapters.react.*` (ModuleRegistryAdapter, UIManagerModuleWrapper,
 * legacy unimodules glue) which IS genuinely dead code under the New Architecture, so we
 * do NOT blanket-keep that tree and we do NOT disable minification wholesale.
 *
 * Lives here (not in android/app/proguard-rules.pro) because `expo prebuild` regenerates
 * android/ on every build — a hand-edit there is silently clobbered. Same reason as
 * withDeviceOwner.js / withAlwaysOnTracking.js.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# --- StrawBoss: keep Expo headless JS app loader (R8 strips it) ---';

const KEEP_RULES = `
${MARKER}
# Resolved only via Class.forName() by expo.modules.apploader.AppLoaderProvider, so R8
# sees no static reference and deletes it. Without these rules NO background JavaScript
# can run when the app has no Activity (boot-rearm after OTA/reboot, presence check-in,
# background sync, FCM presence-wake) and device-owner phones go permanently dark while
# still LOOKING healthy natively. Verified via R8's usage.txt.
-keep class expo.modules.adapters.react.apploader.** { *; }
-keep class expo.modules.apploader.** { *; }
# The headless task plumbing these hand off to.
-keep class expo.modules.taskManager.** { *; }
-keep class expo.modules.backgroundtask.** { *; }
# --- end StrawBoss headless keep rules ---
`;

module.exports = function withHeadlessProguard(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const proguardPath = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );

      let contents = fs.existsSync(proguardPath) ? fs.readFileSync(proguardPath, 'utf8') : '';

      // Idempotent: prebuild may run many times; never append twice.
      if (contents.includes(MARKER)) {
        return cfg;
      }

      fs.writeFileSync(proguardPath, `${contents.trimEnd()}\n${KEEP_RULES}`, 'utf8');
      return cfg;
    },
  ]);
};

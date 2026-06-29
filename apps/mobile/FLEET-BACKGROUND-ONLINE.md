# Fleet phones: always-online + continuous background GPS

How the StrawBoss Device-Owner build keeps a dedicated phone **online and streaming
GPS with the screen off**, and **recovers itself after an OTA self-update or reboot**
without anyone touching it.

Validated end-to-end on a **Samsung Galaxy S25 (SM-S931B, Android 16)** over
`adb`-via-Tailscale (June 2026).

---

## TL;DR

A backgrounded Device-Owner phone stays online by keeping a **foreground service**
alive — that's the only thing aggressive OEM power management can't defeat. Four fixes
make it robust:

| # | Problem | Fix | Commit |
|---|---------|-----|--------|
| 1 | Presence check-in rode a Doze-throttled `AlarmManager` tick (~9 min on Samsung/HONOR) → device flapped offline | Piggyback the **fleet check-in onto the location foreground service** (the one path the OS keeps alive) | `e6053ef` |
| 2 | The presence/alarm path didn't carry GPS, so GPS gapped when backgrounded | The native-alarm presence task also **posts a current GPS fix + drains the outbox** | `182affb` |
| 3 | After an OTA self-update / reboot, the process was killed and **nothing restarted the services** → silently offline until a human opened the app | **`BootReceiver`** (`MY_PACKAGE_REPLACED` + `BOOT_COMPLETED`) + **`BootRearmService`** restart the FGS + GPS unattended | `e70f97b` |
| 4 | On a **cold headless start** the bundle loaded but the router never mounted → `"No task registered for key strawboss-boot-rearm"` → the receiver had nothing to run | Register the headless tasks at the **bundle entry** (`index.js`), not behind the router | `e70f97b` |

---

## Why it's hard: the OEM background-killer landscape

The whole problem is OEM power management killing or freezing a backgrounded app.

- **HONOR / MagicOS** — runs `com.hihonor.powergenie` and `com.hihonor.iaware`,
  **persistent system apps** that freeze background apps **ignoring** the battery-opt
  exemption and the EXEMPT standby bucket. A Device Owner **cannot stop them**:
  `setApplicationHidden` and `setPackagesSuspended` are both refused for persistent
  system packages (verified on-device: `hidden:false, suspended:false`). The only real
  disable is `adb shell pm disable-user com.hihonor.powergenie` (per phone, reversible).
- **Samsung / One UI** — **no proprietary killer**. `oemPowerPackages` is empty. One UI
  *obeys* the battery-opt exemption, so a Device-Owner app with an FGS is not slept.
  Its only lever is **Doze**, which throttles `setExactAndAllowWhileIdle` alarms to
  ~once per 9 min — even for an exempt Device Owner.

**Conclusion: don't fight the killer — keep a foreground service alive and ride it.**
The empirical key (S25 soak): the **location foreground service** is the one background
path One UI keeps fully alive — GPS posted every ~20 s for 10 min screen-off while the
alarm-driven check-in was frozen 8.5 min.

---

## The four fixes in detail

### 1 + 2 — Presence and GPS ride the foreground service, not the alarm
- `apps/mobile/src/lib/location.ts` — the location FGS task now calls a throttled
  `maybePresenceCheckin()` (`runDeviceCheckin`, ~55 s) **before** the no-machine
  early-return. Whenever the location service runs (i.e. a machine is assigned — the
  normal operating state) the device check-in rides it and stays online through Doze.
- `apps/mobile/src/lib/presence-checkin-task.ts` — the native-alarm headless task
  also posts a current GPS fix + flushes the outbox, so GPS keeps flowing even when the
  continuous location FGS isn't running.
- Backend: `location/report` is idempotent (`ON CONFLICT`) and a stale/cross-org
  machine id returns a 204 no-op instead of a 400 the client replays (migration
  `00067`). See `[[project-gps-ingestion-replay-trap]]`.

### 3 — Restart services after the process is killed (`BootReceiver` + `BootRearmService`)
`apps/mobile/plugins/withDeviceOwner.js` generates two native classes:
- **`BootReceiver`** — `exported`, intent-filter for `BOOT_COMPLETED`,
  `MY_PACKAGE_REPLACED`, `QUICKBOOT_POWERON` (priority 999). On fire it
  `startForegroundService(PresenceService)` (allowed from background because the app is
  device-owner + battery-opt **`SYSTEM_ALLOW_LISTED`**) and starts `BootRearmService`.
- **`BootRearmService`** — a `HeadlessJsTaskService` that runs the existing
  `strawboss-boot-rearm` JS task (post-OTA check-in, re-assert PresenceService,
  restart GPS tracking when a machine is assigned).

### 4 — Register headless tasks at the bundle entry (`index.js`)
`register-background-tasks` was imported only from `app/_layout.tsx` (a router screen).
A cold headless start (process killed → fresh runtime, no Activity) loaded the bundle
but never mounted the router → the tasks were never registered → `BootRearmService` got
`"No task registered for key strawboss-boot-rearm"`. Fixed with a custom entry:

```js
// apps/mobile/index.js   (package.json "main": "index.js")
import './src/lib/register-background-tasks'; // register tasks FIRST (headless-safe)
import 'expo-router/entry';                    // then the router
```

---

## Validation (on-device, screen off, unattended)

**Scenario: OTA self-update** (`adb install -r` fires `MY_PACKAGE_REPLACED`, screen off,
phone untouched):

```
logcat:  Background started FGS: Allowed ... BootRearmService ... code:DEVICE_OWNER
         Background started FGS: Allowed ... PresenceService   ... code:DEVICE_OWNER
         TaskService: Registered task 'strawboss-location-updates'   ← entry fix
         (no more "No task registered")

4-min screen-off hold soak (mWakefulness=Dozing throughout):
  min | check-in lag | gps age
  0   | 10 s         | 9 s
  1   | 11 s         | 10 s
  2   | 12 s         | 7 s
  3   | 12 s         | 11 s
  4   | 13 s         | 12 s
```

→ The phone killed by the update **brought itself back online and resumed GPS** with
no human interaction, and held steady screen-off (threshold is 90 s).

---

## Known limitations / caveats

- **Continuous 20 s location FGS can't restart from the background.** Android 14+/Expo
  rejects it: `"Foreground location task cannot be started while the app is in the
  background"`. After an unattended OTA the phone runs on the **60 s presence-checkin
  GPS post** (fix #2) until a user next opens the app, which upgrades it to the 20 s
  continuous FGS. For active shifts (app opened at least once) you get full continuous
  GPS; unattended you get ~60 s GPS — still "always online + sending location".
- **`BOOT_COMPLETED` fires only after the first unlock** (the app uses
  credential-encrypted storage, so it can't run during direct boot). A phone that
  reboots and is never unlocked stays offline until someone unlocks it once. OTA
  self-updates have no such restriction (the phone is already unlocked/running).
- **HONOR PowerGenie/iAware cannot be programmatically disabled** (persistent system
  apps). Use `adb shell pm disable-user com.hihonor.powergenie` per phone if needed.
  See `[[project-honor-powergenie-hide-fails]]`.

---

## Building the APK on this server (env notes)

The release Gradle build does **not** run as `miro` out of the box — the real Android
SDK (with the NDK) lives at root-only `/root/Android/Sdk`, the system SDK
`/usr/lib/android-sdk` is read-only and has no NDK, and there's no passwordless sudo.
What it took:

1. **User-local SDK + NDK** (writable, `miro`-owned):
   ```bash
   SDK=$HOME/Android/Sdk
   curl -fsSL -o /tmp/cmdtools.zip \
     https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
   unzip -q /tmp/cmdtools.zip -d "$SDK/cmdline-tools" && \
     mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
   yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses
   "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
     "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
   ```
2. **Point the build at it** — `_mobile_resolve_android_home` reads `.env` only when
   `ANDROID_HOME` is unset, so export it:
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   ```
3. **Clear stale root-owned native artifacts** from prior root builds (the `node_modules`
   ACL grants `miro` rwx, so this works):
   ```bash
   find node_modules/.pnpm -maxdepth 7 -type d -path "*/android/build" -prune -exec rm -rf {} +
   find node_modules/.pnpm -maxdepth 7 -type d -path "*/android/.cxx"  -prune -exec rm -rf {} +
   rm -rf apps/mobile/android/app/build apps/mobile/android/app/.cxx apps/mobile/android/build apps/mobile/android/.gradle
   ```
4. **Metro cache** — `/tmp/metro-cache` is root-owned (sticky-bit `/tmp`); redirect it:
   ```bash
   export TMPDIR=$HOME/.strawboss-tmp && mkdir -p "$TMPDIR"
   ```
5. Build (the script auto-bumps versionCode — never edit it by hand):
   ```bash
   env ANDROID_HOME=$HOME/Android/Sdk TMPDIR=$HOME/.strawboss-tmp \
     ./strawboss.sh mobile-build-local release --fast
   ```

The APK is archived under `uploads/apks/` and auto-registered as a published OTA release.

## Testing on a live phone via adb over Tailscale

```bash
# On the phone (one-time, via USB — does NOT survive reboot):
adb tcpip 5555
# From this server (phone on the tailnet, e.g. miro-s25 = 100.114.58.32):
adb connect 100.114.58.32:5555        # approve the prompt on the phone
adb -s 100.114.58.32 install -r uploads/apks/strawboss-v1.0.28-vc32-*.apk  # fires MY_PACKAGE_REPLACED
# Verify UNATTENDED (do NOT open the app):
adb -s 100.114.58.32 shell input keyevent 223   # screen off
adb -s 100.114.58.32 shell dumpsys activity services com.strawboss.mobile | grep ServiceRecord
# → PresenceService running; DB last_checkin + GPS go fresh within ~60 s.
```

Related memory: `[[project-honor-js-pause-presence]]`, `[[project-gps-ingestion-replay-trap]]`,
`[[project-honor-powergenie-hide-fails]]`, `[[project-device-owner-build]]`,
`[[project-fleet-ota-selfupdate]]`.

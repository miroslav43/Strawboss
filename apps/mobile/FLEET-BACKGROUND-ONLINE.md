# Fleet phones: always-online + continuous background GPS

How the StrawBoss Device-Owner build keeps a dedicated phone **online and streaming
GPS with the screen off**, and **recovers itself after an OTA self-update or reboot**
without anyone touching it.

Validated end-to-end on a **Samsung Galaxy S25 (SM-S931B, Android 16)** over
`adb`-via-Tailscale (June 2026).

---

## TL;DR

A backgrounded Device-Owner phone stays online by keeping a **foreground service**
alive — but over **hours** in *real* deep Doze even that isn't enough on its own (the
exact wake-alarm the check-in rides gets throttled/cancelled), so a **server-side
dead-man + high-priority FCM** (Doze-exempt) is the final backstop. Six layers make it
robust:

| # | Problem | Fix | Commit |
|---|---------|-----|--------|
| 1 | Presence check-in rode a Doze-throttled `AlarmManager` tick (~9 min on Samsung/HONOR) → device flapped offline | Piggyback the **fleet check-in onto the location foreground service** (the one path the OS keeps alive) | `e6053ef` |
| 2 | The presence/alarm path didn't carry GPS, so GPS gapped when backgrounded | The native-alarm presence task also **posts a current GPS fix + drains the outbox** | `182affb` |
| 3 | After an OTA self-update / reboot, the process was killed and **nothing restarted the services** → silently offline until a human opened the app | **`BootReceiver`** (`MY_PACKAGE_REPLACED` + `BOOT_COMPLETED`) + **`BootRearmService`** restart the FGS + GPS unattended | `e70f97b` |
| 4 | On a **cold headless start** the bundle loaded but the router never mounted → `"No task registered for key strawboss-boot-rearm"` → the receiver had nothing to run | Register the headless tasks at the **bundle entry** (`index.js`), not behind the router | `e70f97b` |
| 5 | **The whole always-on anchor was bootstrapped only from JS** — the React effect (needs `isAuthenticated`) or `boot-rearm` (needs a token). If the session was lost → login screen, or a plain OEM/low-memory kill fired no `BootReceiver`, **`PresenceService` never (re)started** → the idle device-owner phone had no FGS → fell to **cached → frozen → offline** with no self-recovery. Confirmed on an SM-G556B: pre-touch the process was `cch+10` (cached), no FGS, alarms piled up unfired. | Start `PresenceService` **natively from `MainApplication.onCreate` on every process start** (device-owner only), independent of JS + auth. Plus: the presence alarm **re-asserts** the FGS each tick, and `boot-rearm` arms presence **before** the token guard. | `77635b9` |
| 6 | **Over HOURS in real deep Doze the phone still went offline even with the FGS alive** — ground-truth: 3 vc36 device-owner phones silent ~11 h; process alive, FGS present, but the `setExactAndAllowWhileIdle` presence alarm was throttled to Doze maintenance windows (backing off **1 h → 2 h → 4 h**) / cancelled on FGS teardown. A `user_sessions` gap of 18 h confirmed the web went gray overnight. The on-device nets (presence alarm + watchdog) are ALL exact-idle alarms → same throttle, can't beat it. | **Three OS-driven nets + one external:** (a) alarm **not cancelled** on `onDestroy`; (b) a **`WatchdogAlarm`** (~10 min, independent of the service) re-asserts the FGS + re-arms the presence loop; (c) a **`NightlyAlarm`** clean-restarts the *process* ~03:30 (not a device reboot — lock-screen trap); (d) **backend presence dead-man** (BullMQ, 2 min) FCM-wakes any device-owner phone whose `last_checkin_at` is stale — **high-priority FCM is Doze-exempt**, so it's the only thing that reliably pierces deep Doze. Requires `FIREBASE_SERVICE_ACCOUNT[_FILE]` on the backend. | `56071d8` + backend |

> **Why "native" (fix #5) is right:** an anchor that must be *always* running cannot depend on whether React mounted an effect, a Supabase session hydrated, or a system broadcast fired. `MainApplication.onCreate` runs on **every** process start, so the FGS comes up before any JS/auth logic.
>
> **Why the dead-man (fix #6) is non-negotiable for deep Doze:** every on-device timer is a `setExactAndAllowWhileIdle` alarm, and in *real* prolonged Doze those get deferred to the maintenance windows (hours apart) — even the watchdog. Only a **push from outside** (high-priority FCM) bypasses Doze. So the server watches `last_checkin_at` and pokes silent phones. Without FCM configured, a deep-dozing phone is only recovered when a human touches it.
>
> ⚠️ **Testing pitfall:** `dumpsys deviceidle force-idle` does NOT reproduce this — forced-idle still lets exact-idle alarms fire at 60 s. Only a phone left **unplugged, screen-off, stationary for hours** hits the exponential-backoff maintenance windows. And **an active `adb` connection keeps the device awake** — validate via `user_sessions` / `last_checkin_at` in the DB or a *passive* on-device logcat-to-file, not live adb polling.

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

### 5 — Native always-on anchor: start `PresenceService` from `onCreate` (auth-independent)

The bug behind the "latest APK broke always-on" reports was **not** a changed line — it
was that `PresenceService` (the keep-alive FGS everything else rides) was only ever
started from **JS**:

- `app/_layout.tsx` — a React effect gated on `isAuthenticated && profileReady && role`.
  If the session is lost the app sits on the **login screen** and the effect early-returns,
  so the anchor never starts.
- `src/lib/boot-rearm.ts` — only on `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`, and (old
  code) only *after* a `getAuthToken()` guard.

A plain OEM / low-memory kill of the process fires **no** `BootReceiver`, so nothing
restarted the anchor. Result: an idle device-owner phone was left with no foreground
service → the OS moved it to **cached → frozen** → check-ins stopped and it could not
recover itself. (Confirmed on an SM-G556B via adb-over-Tailscale: process `cch+10`, zero
FGS, `PresenceAlarmReceiver` alarms piled up unfired for hours.)

The fix decouples the anchor from JS and auth, in three layers:

1. **`plugins/withDeviceOwner.js` → `patchMainApplication`** injects into
   `MainApplication.onCreate` (runs on **every** process start):
   ```kotlin
   try {
     if (DeviceOwnerPolicies.isDeviceOwner(this)) {
       PresenceService.start(this)   // startForegroundService — DO + battery-exempt = allowed from bg
     }
   } catch (t: Throwable) { Log.w("StrawbossBoot", "onCreate presence autostart failed", t) }
   ```
2. **`PresenceAlarmReceiver.onReceive`** now re-asserts `PresenceService` on every ~60 s
   tick (the alarm re-arms itself in `finally`, so it outlives a transient service death).
3. **`boot-rearm.ts`** arms `PresenceService` **before** the token guard — the check-in it
   dispatches hits the **public** `/fleet/checkin`, so device presence reports even with no
   user token; the operator heartbeat resumes when the session hydrates.

Since `onCreate` fires on cold launch, headless task, sticky restart, and any alarm/FCM/Job
wake, the anchor is always re-established; combined with `START_STICKY` and
`setUserControlDisabledPackages` (already applied), the process is genuinely un-killable
once up. **Latent footgun left in place (moot after this fix):** the `_layout.tsx` effect
cleanup calls `stopPresenceService()`; on this Expo/RN (bridgeless, retained `ReactHost`)
the root tree does **not** unmount on Activity destruction, so it does not fire — and even
if it did, the next `onCreate` / alarm tick revives the anchor.

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

### Debugging a phone connected to a laptop (adb server over Tailscale)

When the phone is on a laptop's USB (not on the tailnet itself), expose the laptop's adb
server to this VM instead of moving the phone:

```bash
# On the laptop (leave running):
adb kill-server && adb -a nodaemon server        # -a = listen on all interfaces incl. Tailscale
# On this VM (laptop = maleticis-macbook-pro = 100.102.162.74):
export ADB_SERVER_SOCKET=tcp:100.102.162.74:5037
adb devices -l                                   # the USB phone shows up here
```

**The five checks that pinpoint "why is this phone offline" (this exact class of bug):**

```bash
S=<serial>
# 1. Is the process alive but CACHED/frozen? cch+NN / (previous-expired) = frozen, no anchor.
adb -s $S shell dumpsys activity processes | grep -i "Proc #.*strawboss"
# 2. Which FGS are actually foreground? Need PresenceService (types=0x40000000 SPECIAL_USE)
#    and/or LocationTaskService (types=0x8). isForeground=true is the proof.
adb -s $S shell dumpsys activity services com.strawboss.mobile | grep -E "ServiceRecord|isForeground"
# 3. Is the keep-alive notification actually posted? (proves the FGS reached foreground)
adb -s $S shell dumpsys notification | grep id=991188
# 4. Are presence alarms firing or piling up unfired? (frozen process can't drain them)
adb -s $S shell dumpsys alarm | grep -c PresenceAlarmReceiver
# 5. Still device owner + battery-exempt? (both are prerequisites for bg FGS start)
adb -s $S shell dumpsys device_policy | grep -i "device owner"
adb -s $S shell dumpsys deviceidle whitelist | grep strawboss
```

Simulate the field condition deterministically (all reversible):
`settings put global always_finish_activities 1` (destroy Activity on background),
`dumpsys battery unplug` + `dumpsys deviceidle step`×6 (force deep Doze),
`am kill com.strawboss.mobile` (OEM/low-memory kill — refused while an FGS is up, which is
itself the proof the anchor protects the process). Restore with `always_finish_activities 0`,
`dumpsys deviceidle unforce`, `dumpsys battery reset`. **Note:** `am force-stop` logs the app
out (drops to the login screen) — use `am kill`, not `force-stop`, to test recovery.

**Two gotchas when validating the onCreate autostart (fix #5) on a device-owner phone:**

- `am force-stop` is **ignored** on the protected package (`setUserControlDisabledPackages`) —
  logcat shows `Ignoring request to force stop protected package`. The process never restarts,
  so `onCreate` never re-runs. Use **`am kill`** (backgrounded, no FGS up) to force a genuine
  process restart, then relaunch — `onCreate` then starts PresenceService (proven while
  **logged out** on a fresh enrol: `ActivityManager: Background started FGS: Allowed …
  reasonCode:SYSTEM_ALLOW_LISTED … PresenceService`).
- The `onCreate` background FGS start is **allowed by the battery-opt exemption**
  (`SYSTEM_ALLOW_LISTED`). QR provisioning / `DeviceOwnerPolicies.applyAll` (on first app open)
  applies it; an **adb-enrolled** phone needs it added first
  (`dumpsys deviceidle whitelist +com.strawboss.mobile`, or open the app once) or a headless
  FGS start can be rejected. adb device-owner enrol flow: `INSTALARE-DEVICE-OWNER.md` §7.

Related memory: `[[project-honor-js-pause-presence]]`, `[[project-gps-ingestion-replay-trap]]`,
`[[project-honor-powergenie-hide-fails]]`, `[[project-device-owner-build]]`,
`[[project-fleet-ota-selfupdate]]`.

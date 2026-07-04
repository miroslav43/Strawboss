# SMS Gateway (`com.smsgateway.app`)

A small native Android (Kotlin) app that turns a phone with a SIM into StrawBoss's
outbound-SMS sender. The backend never talks to an SMS provider directly — it writes
rows into the `outbound_messages` outbox, and this app delivers them through the SIM.

This source tree was **recovered by decompiling the original `SmsGateway.apk`**
(kept at [`prebuilt/SmsGateway-1.0-debug.apk`](prebuilt/)) and reconstructed as a
buildable Gradle project, then extended with a **pull (poll) mode** so it no longer
needs Tailscale.

## Two transports

| | Legacy **push** (`HttpServer`) | **Pull / poll** (`CheckinClient`) — default |
|---|---|---|
| Who connects | Server → phone (`POST http://<phone>:8080/send-sms`) | Phone → server (`POST <url>/api/v1/fleet/checkin`) |
| Needs a reachable phone IP | **Yes** → needs Tailscale / same LAN | **No** — dials out from any network |
| Works on mobile data | No (carrier NAT) | **Yes** |
| Auth | shared API key | per-device token (issued on first check-in) |
| Status | kept, **off by default** (LAN testing) | primary |

### Why pull removes the Tailscale dependency
A phone has no public IP, so a *push* model requires a tunnel (Tailscale) for the
server to reach in. In *pull* mode the phone initiates the connection outbound to
`https://nortiauno.com`, so it works from cellular or any Wi-Fi with **no VPN**.

## How pull mode works
1. On first launch the app generates a random `deviceUuid` and check-ins to
   `POST /api/v1/fleet/checkin`. The backend registers the device and returns a
   `deviceTokenIssued`, which the app stores and sends as `deviceToken` afterwards.
2. Every *poll interval* (default 20s) it check-ins again. For a device flagged
   `is_sms_gateway = true`, the response carries `pendingSms: [{id, to, body}]`
   (claimed atomically server-side: `pending → sent`).
3. The app sends each SMS via `SmsManager` and **queues a delivery report**
   `{id, status:sent|failed, error?}`, which it sends on the **next** check-in
   (`sent → delivered | failed`). So the `/messages` monitor confirms delivery
   within one poll interval.

**Durability window:** reports are persisted to prefs before the next check-in, so an
app/OS kill won't silently drop them. A message left in `sent` (claimed but never
confirmed) is recoverable with the **Retry** button on the admin `/messages` page —
it resets the row to `pending` so a gateway re-claims it.

## Making a phone the gateway (one-time)
1. Install + open the app, grant **SEND_SMS** (and notifications), allow the
   battery-optimization exemption. Set the **Server URL** (`https://nortiauno.com`),
   press **START**. The app registers and the UI shows `înregistrat`.
2. In **super-admin → Devices**, open the phone (it appears under *Unassigned*) and flip
   the **SMS Gateway** toggle on (Remote tab). No SQL needed. (Fallback if ever required:
   `UPDATE devices SET is_sms_gateway = true WHERE device_uuid = '<uuid>';`.)
3. Enqueue a message (any trip-request confirmation, or the **Send test SMS** button on the
   device page) and watch it go `pending → sent → delivered` on `/messages`.

## Remote debug (super-admin, no Tailscale)
The phone answers the fleet's one-shot commands over the same pull channel — open the
device in super-admin → **Remote** tab:
- **Refresh state** (`report_state`) → app version, uptime, battery, SMS sent/failed counts,
  poll interval, `serverUrl`, and `lastError`; shown in the Device Health panel.
- **Fetch logs** (`fetch_logs`) → the app's recent in-memory log tail, shown (expandable) in
  the command history's *Rezultat* column.
- **Send test SMS** → fires a one-off SMS through this gateway.

`reboot` / `reinstall_apk` are intentionally **not** supported (the phone is not a Device
Owner); the app returns `failure` for them so the server stops re-delivering.

## Building
Build via **Android Studio**, or headless on this VM with the miro-owned SDK
(`/home/miro/Android/Sdk`) — the root-owned `/usr/lib/android-sdk` is *not* usable:
```bash
cd SmsGatewayApp
printf 'sdk.dir=/home/miro/Android/Sdk\n' > local.properties   # gitignored
# one-time: the app targets compileSdk 34, so install the matching bits into the SDK
/home/miro/Android/Sdk/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0"
ANDROID_HOME=/home/miro/Android/Sdk ./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk   (debug-signed, installable)
# release (needs your own keystore): ./gradlew :app:assembleRelease
```

### Signing / updating an already-installed phone
The original APK's keystore is **not** in this repo, so a fresh build has a **different
signature** and cannot update the installed app in place — **uninstall the old app,
then install the new one**. Create a keystore once and keep it stable thereafter so
future updates install over the top:
```bash
keytool -genkey -v -keystore smsgateway.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias smsgateway
```
(Keystores are gitignored — never commit them.)

## Config / identity (all in `Prefs`, app-private SharedPreferences `sms_gateway`)
- `serverUrl` (default `https://nortiauno.com`), `pollIntervalSec` (default 20)
- `localServerEnabled` (default false), `apiKey` (legacy local server only)
- `deviceUuid`, `deviceToken`, and the queued delivery-report list

> Security notes:
> - The original build shipped a hardcoded default local-server key (`secret123`);
>   that default is removed — the optional `:8080` server refuses to send until you
>   set a key, and pull mode uses the per-device token instead.
> - The local server caps request bodies (16 KB) so a huge `Content-Length` can't OOM it.
> - `allowBackup=false` keeps the `deviceToken` out of `adb`/cloud backups. The token
>   lives in app-private `SharedPreferences` (plaintext) — a deliberate choice over the
>   flaky EncryptedSharedPreferences/Keystore path on low-end hardware; the phone is a
>   dedicated, non-rooted gateway.
> - `usesCleartextTraffic` stays enabled **on purpose** so the app can also point at an
>   `http://` dev/LAN backend for testing; production uses `https://nortiauno.com`.

## Source map
- `MainActivity.kt` — UI (server URL, interval, local-server toggle, log)
- `SmsGatewayService.kt` — foreground service: WakeLock + poll loop + optional local server
- `CheckinClient.kt` — **pull-mode** check-in: SMS send + delivery-report queue, plus the
  remote-command dispatch (`report_state`, `fetch_logs`) and richer device fields
- `LogBuffer.kt` — in-memory log ring buffer feeding `fetch_logs`
- `HttpServer.kt` — legacy NanoHTTPD push server on `:8080` (optional)
- `SmsSender.kt` — `SmsManager` send (multipart), phone validation
- `NetUtils.kt` — local-IP lookup (for the local-server URL display)
- `Prefs.kt` — config, gateway identity, health counters

## Ideas for later
Boot auto-start (`RECEIVE_BOOT_COMPLETED` + receiver), inbound/2-way SMS, multi-SIM
selection.

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
2. Find its `devices` row and flag it (there is **no admin UI** for this yet):
   ```sql
   -- newest registration is usually the phone you just set up
   SELECT id, device_uuid, model, last_checkin_at
     FROM devices ORDER BY last_checkin_at DESC LIMIT 5;

   UPDATE devices SET is_sms_gateway = true WHERE device_uuid = '<uuid-from-the-app>';
   ```
3. Enqueue a message (any trip-request confirmation) and watch it appear as
   `sent → delivered` on `/messages`.

## Building
Requires the Android SDK (build via **Android Studio**, or CLI with `ANDROID_HOME` set):
```bash
./gradlew assembleRelease      # app/build/outputs/apk/release/app-release-unsigned.apk
# or a quick debug build:
./gradlew assembleDebug
```
> On this server the Android SDK is root-owned and Gradle can't run as the dev user,
> so the APK is built on a machine with the SDK (Android Studio), not on the VM.

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

> Security note: the original build shipped a hardcoded default local-server API key
> (`secret123`). That only matters for the optional `:8080` server; pull mode uses the
> per-device token instead. If you enable the local server, change the key.

## Source map
- `MainActivity.kt` — UI (server URL, interval, local-server toggle, log)
- `SmsGatewayService.kt` — foreground service: WakeLock + poll loop + optional local server
- `CheckinClient.kt` — **pull-mode** check-in / SMS-send / delivery-report queue
- `HttpServer.kt` — legacy NanoHTTPD push server on `:8080` (optional)
- `SmsSender.kt` — `SmsManager` send (multipart), phone validation
- `NetUtils.kt` — local-IP lookup (for the local-server URL display)
- `Prefs.kt` — config + gateway identity

## Ideas for later
Boot auto-start (`RECEIVE_BOOT_COMPLETED` + receiver), inbound/2-way SMS, multi-SIM
selection, and a super-admin toggle for `is_sms_gateway` so step 2 above needs no SQL.

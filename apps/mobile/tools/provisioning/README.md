# StrawBoss — Device Owner provisioning (dedicated operator phones)

This turns a **factory-fresh** Android phone into a fully-managed **Device Owner**
device where StrawBoss:

- auto-grants all its permissions (incl. background location "Allow all the time"),
  **zero taps**;
- cannot be force-stopped / cleared / uninstalled by the operator;
- can open its geofence alert **over any other app and over the lock screen**;
- still leaves the phone usable as a normal phone (no kiosk).

> **This APK variant is for dedicated devices only.** Never install it on a
> personal / BYOD phone — uninstall and force-stop are blocked, and only the
> in-app release valve (or a factory reset) recovers it.

---

## 0. Build the APK

Build the release/dev-client APK as usual (EAS `apk` profile or local gradle —
see the repo's `building-expo-apk` guidance). The `withDeviceOwner` config plugin
runs during `expo prebuild` and injects the DPC. You CANNOT use Expo Go.

After building, host the APK over **HTTPS** with a valid (Let's Encrypt) cert —
plain HTTP and self-signed certs are rejected by Android's provisioner. Use the
repo's `host-site-on-this-vm` convention, e.g.:

```
https://provision.strawboss.<domain>/strawboss-deviceowner.apk
```

Re-host and **regenerate the QR** on every rebuild (the checksum is tied to the
exact APK bytes).

## 1. Generate the QR

```bash
node tools/provisioning/generate-qr.mjs \
  --apk /path/to/strawboss-deviceowner.apk \
  --url https://provision.strawboss.<domain>/strawboss-deviceowner.apk \
  --ssid "FarmWifi" --pass "wifi-password" --security WPA \
  --out strawboss-do-qr.png
```

- Prints the provisioning JSON and writes `strawboss-do-qr.png`.
- `qrcode` (devDependency) is needed for the PNG; without it the script writes the
  JSON to a `.txt` you can paste into any QR generator.
- Wi-Fi args are optional (you can connect to Wi-Fi manually during setup).

## 2. Enroll each phone (~30×)

1. Power on a **factory-fresh** phone (or factory reset). **Do NOT add a Google
   account** — provisioning aborts if any account exists.
2. On the very first **"Hi there / Welcome"** screen, **tap the same spot 6
   times**. The QR enrollment reader opens.
3. Connect to Wi-Fi if asked (or it uses the SSID/password from the QR).
4. **Scan `strawboss-do-qr.png`.** The phone downloads the APK from the HTTPS URL,
   verifies the checksum, installs it, and sets it as Device Owner.
5. `onEnabled` fires → all policies + permissions are applied automatically. The
   operator just logs in.

## ADB alternative (single dev / bench device)

```bash
adb install -r /path/to/strawboss-deviceowner.apk
adb shell dpm set-device-owner com.strawboss.mobile/.StrawbossDeviceAdminReceiver
```

Requires **zero accounts** on the device (remove all accounts or factory reset
first), single user.

## Verify

```bash
adb shell dpm list-owners                                   # shows the receiver
adb shell dumpsys package com.strawboss.mobile | grep -A40 "runtime permissions"
#   → ACCESS_BACKGROUND_LOCATION: granted=true, fine/coarse/CAMERA/POST_NOTIFICATIONS granted
adb shell pm uninstall com.strawboss.mobile                 # → DELETE_FAILED_DEVICE_POLICY_MANAGER
```

In the app: Settings → Apps → StrawBoss shows Force-stop / Uninstall greyed out.

## Decommission (remove ownership without factory reset)

In the app, Profile → tap the role badge **5 times** (reveals the dev tools) →
**"Eliberează dispozitivul"**. This relinquishes Device Owner so the app can be
uninstalled. (Factory reset also works — `DISALLOW_FACTORY_RESET` is intentionally
left off as a safety net.)

## Gotchas

- **Never** add `PROVISIONING_SENSORS_PERMISSION_GRANT_OPT_OUT` to the QR — it
  revokes the device owner's ability to grant background location.
- A stale checksum (APK rebuilt, QR not regenerated) → provisioning fails
  on-device. Always regenerate together.
- Prefer Pixel / Samsung / Motorola for predictable provisioning; some MIUI/EMUI
  builds have quirky enrollment flows.

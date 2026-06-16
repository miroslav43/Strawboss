#!/usr/bin/env node
/**
 * Generate the Android Device Owner QR-provisioning payload (and a PNG QR) for
 * StrawBoss.
 *
 * Factory-fresh phone → tap the welcome screen 6× → scan this QR → the device
 * downloads the APK from the HTTPS URL, verifies the checksum, installs it, and
 * sets StrawBoss as Device Owner. `StrawbossDeviceAdminReceiver.onEnabled` then
 * auto-grants every permission (incl. background location) and locks the app
 * down. See README.md.
 *
 * Usage:
 *   node tools/provisioning/generate-qr.mjs \
 *     --apk ../../path/strawboss-deviceowner.apk \
 *     --url https://provision.strawboss.example.com/strawboss-deviceowner.apk \
 *     [--ssid MyWifi --pass secret --security WPA] \
 *     [--out strawboss-do-qr.png] [--json-only]
 *
 * The checksum is computed FROM the local --apk file, so it always matches the
 * artifact you host. A stale checksum makes provisioning fail on-device — never
 * hand-edit it.
 *
 * The PNG QR needs the optional `qrcode` package; if it isn't installed the
 * script still prints the JSON so you can paste it into any QR generator.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const PACKAGE = 'com.strawboss.mobile';
const ADMIN_COMPONENT = `${PACKAGE}/${PACKAGE}.StrawbossDeviceAdminReceiver`;

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'json-only') {
      out.jsonOnly = true;
      continue;
    }
    out[key] = args[++i];
  }
  return out;
}

const opts = parseArgs(argv.slice(2));

if (!opts.apk || !opts.url) {
  console.error(
    'Missing required args.\n' +
      'Usage: node tools/provisioning/generate-qr.mjs --apk <path-to-apk> --url <https-url> ' +
      '[--ssid <ssid> --pass <pwd> --security WPA] [--out qr.png] [--json-only]',
  );
  exit(1);
}

if (!opts.url.startsWith('https://')) {
  console.error('ERROR: --url must be HTTPS — Android managed-provisioning rejects plain HTTP.');
  exit(1);
}

// URL-safe, unpadded base64 SHA-256 of the APK (== PACKAGE_CHECKSUM format).
let checksum;
try {
  const buf = readFileSync(opts.apk);
  checksum = createHash('sha256').update(buf).digest('base64url');
} catch (err) {
  console.error(`ERROR: could not read APK at ${opts.apk}: ${err.message}`);
  exit(1);
}

const payload = {
  'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': ADMIN_COMPONENT,
  'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': opts.url,
  'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM': checksum,
  'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': false,
  'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
  // DO NOT add PROVISIONING_SENSORS_PERMISSION_GRANT_OPT_OUT — its presence
  // revokes the device owner's ability to grant background location.
};

if (opts.ssid) {
  payload['android.app.extra.PROVISIONING_WIFI_SSID'] = opts.ssid;
  if (opts.pass) payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'] = opts.pass;
  payload['android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE'] = opts.security ?? 'WPA';
}

const json = JSON.stringify(payload, null, 2);
console.log('\n=== Device Owner provisioning JSON ===\n');
console.log(json);
console.log(`\nAPK checksum (sha256 base64url): ${checksum}\n`);

if (opts.jsonOnly) exit(0);

const outFile = opts.out ?? 'strawboss-do-qr.png';
const compact = JSON.stringify(payload); // QR encodes the compact form

try {
  const qrcode = await import('qrcode');
  // High error-correction so a slightly smudged printout still scans.
  await qrcode.toFile(outFile, compact, { errorCorrectionLevel: 'M', margin: 2, scale: 8 });
  console.log(`QR written to ${outFile}`);
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    // Degrade gracefully: emit the compact JSON to a .txt so it can be pasted
    // into any online QR generator.
    const txt = outFile.replace(/\.png$/, '.txt');
    writeFileSync(txt, compact);
    console.warn(
      `\n'qrcode' package not installed — wrote compact JSON to ${txt} instead.\n` +
        "Install it with `pnpm add -D qrcode` (at the mobile package) to emit a PNG, " +
        'or paste the JSON into any QR generator.',
    );
  } else {
    console.error(`ERROR generating QR: ${err.message}`);
    exit(1);
  }
}

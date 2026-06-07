#!/usr/bin/env node
/**
 * Auto-increment the app version before every local build.
 *
 * app.json is the single source of truth: `expo prebuild` regenerates
 * android/app/build.gradle (versionCode / versionName) from it, and the Profile
 * screen reads `Constants.expoConfig.version` + `android.versionCode` (baked at
 * build time). So bumping here makes every locally-built APK:
 *   • install over the previous one (Android requires a higher versionCode), and
 *   • show a new "Versiunea x.y.z (N)" in the profile, so you can tell at a
 *     glance whether the device has the latest build.
 *
 * Wired into the `build:apk` / `build:android:local` scripts; runs before
 * prebuild. Bumps android.versionCode by 1 and the version patch by 1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'app.json');

const raw = readFileSync(appJsonPath, 'utf8');
const cfg = JSON.parse(raw);
const expo = cfg.expo ?? (cfg.expo = {});
expo.android = expo.android ?? {};

// Build counter — must increase for each sideloaded install.
const prevCode = Number.parseInt(String(expo.android.versionCode ?? 0), 10) || 0;
expo.android.versionCode = prevCode + 1;

// Marketing version — bump the patch so the human-readable version also moves.
const parts = String(expo.version ?? '1.0.0')
  .split('.')
  .map((n) => Number.parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1;
expo.version = parts.join('.');

writeFileSync(appJsonPath, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`✓ Version bumped to ${expo.version} (versionCode ${expo.android.versionCode})`);

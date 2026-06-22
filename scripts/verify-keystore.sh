#!/usr/bin/env sh
# verify-keystore.sh — fail if the Android signing keystore ever changes.
#
# WHY: the ~30 Device-Owner phones self-install OTA APKs via PackageInstaller, which
# REQUIRES every new APK to be signed with the SAME key as the installed one. Release
# builds sign with `signingConfigs.debug` (apps/mobile/android/app/debug.keystore).
# If this file changes, OTA self-update BREAKS for every phone already in the field —
# they would each need a manual re-sideload. So the file is pinned by SHA-256 here and
# enforced by the pre-commit hook (.githooks/pre-commit) and CI (keystore-guard.yml).
#
# If you ever MUST rotate the key (rare): update EXPECTED below, accept that the whole
# fleet needs a manual re-sideload of the first APK signed with the new key.
set -eu

KEYSTORE="apps/mobile/android/app/debug.keystore"
EXPECTED="221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58"

if [ ! -f "$KEYSTORE" ]; then
  echo "✗ keystore missing: $KEYSTORE" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$KEYSTORE" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "$KEYSTORE" | awk '{print $1}')
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "✗ OTA SIGNING KEYSTORE CHANGED — refusing." >&2
  echo "  file:     $KEYSTORE" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL" >&2
  echo "  Changing the signing key breaks OTA self-update for all fielded phones." >&2
  echo "  If this is truly intended, update EXPECTED in scripts/verify-keystore.sh and" >&2
  echo "  plan a manual re-sideload of the whole fleet." >&2
  exit 1
fi

echo "✓ debug.keystore signing fingerprint OK ($EXPECTED)"

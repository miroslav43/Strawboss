#!/usr/bin/env bash
# ============================================================================
# mobile.sh — Mobile (Expo / Android) commands
# ============================================================================

# @section "Mobile"

# @cmd mobile-dev "Start Expo dev server (scan QR with Expo Go)"
cmd_mobile__dev() {
  header "Mobile Dev Server (Expo)"
  require_cmd pnpm

  local mobile_dir="$STRAWBOSS_ROOT/apps/mobile"
  [ -d "$mobile_dir" ] || { error "apps/mobile not found."; exit 1; }

  info "Building shared packages for mobile..."
  pnpm --filter @strawboss/types build
  pnpm --filter @strawboss/validation build
  pnpm --filter @strawboss/ui-tokens build
  pnpm --filter @strawboss/api build

  echo ""
  echo -e "  ${CYAN}┌────────────────────────────────────────┐${NC}"
  echo -e "  ${CYAN}│${NC}  Scan QR code with Expo Go app    ${CYAN}│${NC}"
  echo -e "  ${CYAN}│${NC}  Press ${BOLD}a${NC} for Android emulator      ${CYAN}│${NC}"
  echo -e "  ${CYAN}└────────────────────────────────────────┘${NC}"
  echo ""

  ( cd "$mobile_dir" && pnpm dev )
}

# @cmd mobile-build "Android APK via Expo EAS (cloud build)"
cmd_mobile__build() {
  header "Mobile APK (EAS Cloud)"
  require_cmd pnpm

  local mobile_dir="$STRAWBOSS_ROOT/apps/mobile"
  [ -d "$mobile_dir" ] || { error "apps/mobile not found."; exit 1; }
  [ -f "$mobile_dir/eas.json" ] || { error "Missing eas.json"; exit 1; }

  info "EAS cloud build (profile: apk)"
  echo ""

  (
    cd "$mobile_dir"
    pnpm dlx eas-cli@latest build --platform android --profile apk "$@"
  )
}

# @cmd mobile-build-local "Android APK via local Gradle [debug|release] [--fast]"
cmd_mobile__build__local() {
  header "Mobile APK (Local Gradle)"
  require_cmd pnpm

  local variant="debug"
  local fast=0
  for arg in "$@"; do
    case "$arg" in
      --fast) fast=1 ;;
      debug|release) variant="$arg" ;;
      *)
        error "Usage: mobile-build-local [debug|release] [--fast]"
        exit 1
        ;;
    esac
  done

  if ! _mobile_resolve_android_home; then
    error "Android SDK not found. Set ANDROID_HOME in .env"
    exit 1
  fi
  command -v java &>/dev/null || { error "java not found. Install JDK 17+."; exit 1; }

  local mobile_dir="$STRAWBOSS_ROOT/apps/mobile"
  [ -d "$mobile_dir" ] || { error "apps/mobile not found."; exit 1; }

  local dotenv_file=".env.dev"
  if [ "$variant" = "release" ]; then
    dotenv_file=".env.production"
  fi
  if [ ! -f "$mobile_dir/$dotenv_file" ]; then
    error "Missing ${BOLD}$mobile_dir/$dotenv_file${NC}. Copy from .env.dev.example / .env.production.example and fill values."
    exit 1
  fi
  info "Expo env file: ${BOLD}$dotenv_file${NC} (debug → .env.dev, release → .env.production)"

  # Release builds bump version + versionCode BEFORE prebuild so every archived APK has a
  # strictly higher versionCode (PackageInstaller rejects a same/lower-code OTA self-update).
  if [ "$variant" = "release" ]; then
    info "Bumping version + versionCode (release)..."
    ( cd "$mobile_dir" && node scripts/bump-version.mjs )
  fi

  info "Building shared packages..."
  pnpm --filter @strawboss/types build
  pnpm --filter @strawboss/validation build
  pnpm --filter @strawboss/ui-tokens build
  pnpm --filter @strawboss/api build

  info "expo prebuild --platform android..."
  # Use the workspace-local dotenv-cli explicitly: a system-wide python-dotenv on
  # PATH would otherwise be picked up by `pnpm exec dotenv` and reject `-e <file>`.
  ( cd "$mobile_dir" && ./node_modules/.bin/dotenv -e "$dotenv_file" -- pnpm exec expo prebuild --platform android )

  local gradle_task="assembleDebug" out_sub="debug"
  if [ "$variant" = "release" ]; then
    gradle_task="assembleRelease"
    out_sub="release"
    warn "Release builds need signing config in android/"
  fi

  chmod +x "$mobile_dir/android/gradlew" 2>/dev/null || true

  if [ "$fast" -eq 0 ]; then
    info "Stopping Kotlin/Gradle daemons (avoids corrupted incremental Kotlin cache)..."
    ( cd "$mobile_dir/android" && ./gradlew --stop >/dev/null 2>&1 || true )

    # `./gradlew clean` triggers externalNativeBuildCleanDebug, which re-runs CMake
    # over stale `.cxx/*/build.ninja` referencing codegen JNI dirs that may have
    # been wiped by `expo prebuild` / pnpm re-linking. We delete caches by hand.
    info "Removing stale Android native caches (.cxx + build)..."
    rm -rf "$mobile_dir/android/app/.cxx" \
           "$mobile_dir/android/app/build" \
           "$mobile_dir/android/build" \
           "$mobile_dir/android/.gradle/caches/transforms-4" 2>/dev/null || true
  else
    info "Skipping daemon stop + clean (--fast)"
  fi

  info "Gradle: ./gradlew $gradle_task (with $dotenv_file for bundled EXPO_PUBLIC_*)"
  ( cd "$mobile_dir" && ./node_modules/.bin/dotenv -e "$dotenv_file" -- sh -c "cd android && ./gradlew $gradle_task" )

  local apk_dir="$mobile_dir/android/app/build/outputs/apk/$out_sub"
  echo ""
  success "APK built!"
  echo -e "  ${ARROW}  ${BOLD}$apk_dir/${NC}"

  local apk_file
  apk_file=$(find "$apk_dir" -name "*.apk" -type f 2>/dev/null | head -1)
  if [ -n "$apk_file" ]; then
    local apk_size
    apk_size=$(_stat_size "$apk_file")
    echo -e "  ${DOT}  $(basename "$apk_file")  ${DIM}($(_human_size "$apk_size"))${NC}"
  fi
  echo ""

  # Release builds: archive the APK under the served uploads dir with a descriptive name
  # and register it as a published OTA release (keeps only the newest 10).
  if [ "$variant" = "release" ] && [ -n "$apk_file" ]; then
    _mobile_register_release "$apk_file"
  fi
}

# Archive a freshly-built release APK into <UPLOADS_ROOT>/apks/ with a descriptive name
# (strawboss-v<version>-vc<code>-<gitshort>.apk), register it in app_releases as `published`,
# and prune to the newest 10 (soft-delete + delete files, skipping releases still referenced
# by a pending/active deployment). Best-effort: a missing psql/DATABASE_URL only warns — the
# APK is still built and can be uploaded manually from the UI.
_mobile_register_release() {
  local apk_file="$1"
  local mobile_dir="$STRAWBOSS_ROOT/apps/mobile"

  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — skipping release registration (APK still built; upload it from the UI)."
    return 0
  fi
  _load_env
  if [ -z "${DATABASE_URL:-}" ]; then
    warn "DATABASE_URL not set — skipping release registration (APK still built; upload it from the UI)."
    return 0
  fi

  local version version_code
  version=$(node -p "require('$mobile_dir/app.json').expo.version" 2>/dev/null)
  version_code=$(node -p "require('$mobile_dir/app.json').expo.android.versionCode" 2>/dev/null)
  if [ -z "$version" ] || [ -z "$version_code" ]; then
    error "Could not read version/versionCode from app.json — skipping registration."
    return 1
  fi

  local git_short commit_subj
  git_short=$(git -C "$STRAWBOSS_ROOT" rev-parse --short HEAD 2>/dev/null || echo "nogit")
  commit_subj=$(git -C "$STRAWBOSS_ROOT" log -1 --pretty=%s 2>/dev/null || echo "")

  local uploads_dir="${UPLOADS_ROOT:-$STRAWBOSS_ROOT/uploads}"
  mkdir -p "$uploads_dir/apks"

  local fname="strawboss-v${version}-vc${version_code}-${git_short}.apk"
  local apk_key="apks/$fname"
  local dest="$uploads_dir/$apk_key"
  cp -f "$apk_file" "$dest"
  chmod 644 "$dest" 2>/dev/null || true

  local sha256 size
  sha256=$(sha256sum "$dest" | awk '{print $1}')
  size=$(_stat_size "$dest")

  info "Registering release ${BOLD}$version (vc$version_code)${NC} as published..."

  # Insert (idempotent on version_code) + prune to newest 10 in one session. psql `:'var'`
  # interpolation safely quotes the changelog (which may contain arbitrary commit text).
  local pruned
  pruned=$(psql "$DATABASE_URL" -X -A -t -q \
    -v version="$version" \
    -v vcode="$version_code" \
    -v apk_key="$apk_key" \
    -v sha="$sha256" \
    -v size="$size" \
    -v changelog="${git_short} — ${commit_subj}" <<'SQL'
INSERT INTO app_releases (id, version, version_code, apk_key, sha256, size_bytes, changelog, mandatory, status)
VALUES (gen_random_uuid(), :'version', :'vcode'::int, :'apk_key', :'sha', :'size'::bigint, :'changelog', false, 'published'::release_status)
ON CONFLICT (version_code) WHERE deleted_at IS NULL
DO UPDATE SET apk_key = EXCLUDED.apk_key, sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes,
             changelog = EXCLUDED.changelog, status = 'published'::release_status, updated_at = now();

WITH ranked AS (
  SELECT id, apk_key, ROW_NUMBER() OVER (ORDER BY version_code DESC) AS rn
  FROM app_releases WHERE deleted_at IS NULL
)
UPDATE app_releases ar
SET deleted_at = now(), updated_at = now()
FROM ranked r
WHERE ar.id = r.id AND r.rn > 10
  AND NOT EXISTS (
    SELECT 1 FROM ota_deployments od
    WHERE od.release_id = ar.id AND od.status IN ('pending', 'active')
  )
RETURNING ar.apk_key;
SQL
  ) || {
    warn "Release registration failed (DB unreachable?) — APK is built; you can upload it from the UI."
    pruned=""
  }

  if [ -n "$pruned" ]; then
    local n=0
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      rm -f "$uploads_dir/$key" 2>/dev/null || true
      n=$((n + 1))
    done <<EOF
$pruned
EOF
    info "Pruned $n old release file(s) — kept the newest 10."
  fi

  success "Release archived + registered (published)."
  echo -e "  ${DOT}  ${BOLD}$fname${NC}"
  echo -e "  ${DIM}→ apare în UI: Fleet → Releases (sus, instalabil din modalul de push)${NC}"
  echo ""
}

# @cmd mobile-install "Install APK on connected device via adb [apk-path]"
cmd_mobile__install() {
  header "Install APK on Device"

  local apk_file="${1:-}"

  if [ -z "$apk_file" ]; then
    # find exits 1 if the APK tree does not exist yet; with pipefail + set -e that would
    # abort the script before we can print "No APK found" — swallow pipeline failure.
    apk_file=$(find "$STRAWBOSS_ROOT/apps/mobile/android/app/build/outputs/apk" -name "*.apk" -type f 2>/dev/null | sort -r | head -1) || true
    if [ -z "$apk_file" ]; then
      error "No APK found. Run ${BOLD}./strawboss.sh mobile-build-local${NC} first."
      exit 1
    fi
    info "Found: $apk_file"
  fi

  [ -f "$apk_file" ] || { error "File not found: $apk_file"; exit 1; }

  local adb_bin="adb"
  if ! command -v adb &>/dev/null; then
    _mobile_resolve_android_home 2>/dev/null || true
    if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
      adb_bin="$ANDROID_HOME/platform-tools/adb"
    else
      error "adb not found. Install Android platform-tools."
      exit 1
    fi
  fi

  local devices
  # grep -c returns exit 1 when count is 0; with pipefail, `|| echo "0"` appended a
  # second line → devices="0\n0" → `[ "$devices" -eq 0 ]` fails under set -e. Use `|| true`.
  devices=$("$adb_bin" devices 2>/dev/null | grep -c "device$" || true)

  if [ "$devices" -eq 0 ]; then
    error "No devices connected. Connect via USB or start an emulator."
    echo -e "  ${DIM}Tip: Enable USB Debugging in Developer Options on your phone${NC}"
    exit 1
  fi

  info "Installing on $devices device(s)..."
  local apk_size
  apk_size=$(_stat_size "$apk_file")
  echo -e "  ${DOT}  $(basename "$apk_file")  ${DIM}($(_human_size "$apk_size"))${NC}"
  echo ""

  "$adb_bin" install -r "$apk_file"
  echo ""
  success "Installed! Look for ${BOLD}StrawBoss${NC} on the device."
}

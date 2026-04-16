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
  echo -e "  ${CYAN}\\u250C\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510${NC}"
  echo -e "  ${CYAN}\\u2502${NC}  Scan QR code with Expo Go app    ${CYAN}\\u2502${NC}"
  echo -e "  ${CYAN}\\u2502${NC}  Press ${BOLD}a${NC} for Android emulator      ${CYAN}\\u2502${NC}"
  echo -e "  ${CYAN}\\u2514\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2518${NC}"
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

# @cmd mobile-build-local "Android APK via local Gradle [debug|release]"
cmd_mobile__build__local() {
  header "Mobile APK (Local Gradle)"
  require_cmd pnpm

  local variant="${1:-debug}"
  if [ "$variant" != "debug" ] && [ "$variant" != "release" ]; then
    error "Usage: mobile-build-local [debug|release]"
    exit 1
  fi

  if ! _mobile_resolve_android_home; then
    error "Android SDK not found. Set ANDROID_HOME in .env"
    exit 1
  fi
  command -v java &>/dev/null || { error "java not found. Install JDK 17+."; exit 1; }

  local mobile_dir="$STRAWBOSS_ROOT/apps/mobile"
  [ -d "$mobile_dir" ] || { error "apps/mobile not found."; exit 1; }

  info "Building shared packages..."
  pnpm --filter @strawboss/types build
  pnpm --filter @strawboss/validation build
  pnpm --filter @strawboss/ui-tokens build
  pnpm --filter @strawboss/api build

  info "expo prebuild --platform android..."
  ( cd "$mobile_dir" && pnpm exec expo prebuild --platform android )

  local gradle_task="assembleDebug" out_sub="debug"
  if [ "$variant" = "release" ]; then
    gradle_task="assembleRelease"
    out_sub="release"
    warn "Release builds need signing config in android/"
  fi

  info "Gradle: ./gradlew $gradle_task"
  chmod +x "$mobile_dir/android/gradlew" 2>/dev/null || true
  ( cd "$mobile_dir/android" && ./gradlew "$gradle_task" )

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
}

# @cmd mobile-install "Install APK on connected device via adb [apk-path]"
cmd_mobile__install() {
  header "Install APK on Device"

  local apk_file="${1:-}"

  if [ -z "$apk_file" ]; then
    apk_file=$(find "$STRAWBOSS_ROOT/apps/mobile/android/app/build/outputs/apk" -name "*.apk" -type f 2>/dev/null | sort -r | head -1)
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
  devices=$("$adb_bin" devices 2>/dev/null | grep -c "device$" || echo "0")
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

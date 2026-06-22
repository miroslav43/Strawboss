#!/usr/bin/env bash
# enable-adb-tcp.sh — STANDALONE laptop helper for the StrawBoss fleet.
#
# Enables ADB-over-TCP (port 5555) on a USB-connected Android phone so the phone can be
# reached over Tailscale afterwards. Android won't let even a Device Owner flip adbd to TCP
# without this one-time USB step on non-rooted phones; it resets when the phone reboots.
#
# Run this ON YOUR LAPTOP (the machine the phone is plugged into via USB) — it has no
# dependency on the repo / strawboss.sh / the database.
#
# Usage:
#   ./enable-adb-tcp.sh               # enable ADB-over-TCP on the USB-connected phone
#   ./enable-adb-tcp.sh connect <ip>  # adb connect <tailnet-ip>:5555 + open a shell
#                                     #   (only if THIS laptop is also on the tailnet;
#                                     #    otherwise run `./strawboss.sh fleet:tunnel` on the VM)
#
# Prereqs: USB cable, "USB debugging" ON (Settings > Developer options), and you've tapped
# "Allow" on the phone's authorization prompt.
# macOS: if adb is missing → `brew install android-platform-tools`.
set -euo pipefail

# ── locate adb (PATH, then common Android SDK locations) ──────────────────────
find_adb() {
  if command -v adb >/dev/null 2>&1; then echo "adb"; return 0; fi
  local c
  for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
           "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" \
           "/opt/android-sdk" "/usr/lib/android-sdk"; do
    [ -n "$c" ] && [ -x "$c/platform-tools/adb" ] && { echo "$c/platform-tools/adb"; return 0; }
  done
  return 1
}

if ! ADB=$(find_adb); then
  echo "✗ adb not found." >&2
  echo "  macOS:  brew install android-platform-tools" >&2
  echo "  Linux:  sudo apt-get install -y android-tools-adb" >&2
  echo "  …or set ANDROID_HOME to your Android SDK path." >&2
  exit 1
fi

# ── optional: connect + shell (laptop must be on the tailnet) ─────────────────
if [ "${1:-}" = "connect" ]; then
  ip="${2:-}"
  [ -n "$ip" ] || { echo "Usage: $0 connect <tailnet-ip>" >&2; exit 1; }
  echo "→ adb connect $ip:5555"
  out=$("$ADB" connect "$ip:5555" 2>&1) || true
  echo "  $out"
  # `adb connect` exits 0 even on failure — must parse the output.
  if ! printf '%s' "$out" | grep -qiE 'connected to'; then
    echo "✗ connect failed." >&2
    echo "  Enable ADB-over-TCP first (run this script with no args over USB)," >&2
    echo "  and make sure THIS laptop is on the same Tailscale tailnet." >&2
    exit 1
  fi
  echo "✓ connected — opening shell (exit / Ctrl-D to leave; tunnel stays until reboot)"
  echo ""
  exec "$ADB" -s "$ip:5555" shell
fi

# ── default: enable ADB-over-TCP on the single USB device ─────────────────────
echo "Using adb: $ADB"
"$ADB" start-server >/dev/null 2>&1 || true
echo ""
echo "adb devices:"
"$ADB" devices | sed '1d;/^[[:space:]]*$/d;s/^/  /'
echo ""

states=$("$ADB" devices | awk 'NR>1 && NF>=2 {print $2}')
authorized=$(printf '%s\n' "$states" | grep -c '^device$' || true)
unauth=$(printf '%s\n' "$states" | grep -c '^unauthorized$' || true)

if [ "${unauth:-0}" -gt 0 ]; then
  echo "✗ Phone shows as 'unauthorized'." >&2
  echo "  On the phone, tap 'Allow USB debugging' (check 'Always allow from this computer')." >&2
  exit 1
fi
if [ "${authorized:-0}" -eq 0 ]; then
  echo "✗ No authorized USB device found." >&2
  echo "  Connect the phone via USB with 'USB debugging' ON, then re-run." >&2
  exit 1
fi
if [ "${authorized:-0}" -gt 1 ]; then
  echo "✗ More than one device connected — connect exactly one phone." >&2
  exit 1
fi

echo "→ adb tcpip 5555"
out=$("$ADB" tcpip 5555 2>&1) || true
echo "  $out"
if printf '%s' "$out" | grep -qiE 'restarting in tcp mode|in tcp mode'; then
  echo ""
  echo "✓ ADB-over-TCP enabled on :5555 (resets when the phone reboots)."
  echo "  Now, from the VM (phone on Tailscale):  ./strawboss.sh fleet:tunnel \"<nickname>\""
  echo "  Or from this laptop (if on the tailnet):  $0 connect <tailnet-ip>"
else
  echo "✗ Failed to enable ADB-over-TCP — see the message above." >&2
  exit 1
fi

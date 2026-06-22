#!/usr/bin/env bash
# ============================================================================
# fleet.sh — Fleet remote access (Tailscale status sync + ADB tunneling)
#
# The fleet phones (Device Owner) join the SAME tailnet as this VM. The backend
# runs in a bridge-network container and CANNOT reach the tailnet or run adb, so
# these are HOST-side utilities: a status sync that feeds the red/green dot in the
# super-admin UI, and an ADB tunnel opener over the tailnet.
# ============================================================================

# @section "Fleet"

# @cmd fleet:tailscale-sync "Sync `tailscale status` into devices table (drives the UI online dot)"
cmd_fleet__tailscale__sync() {
  header "Tailscale → DB status sync"
  require_cmd tailscale
  require_cmd psql
  require_cmd node
  _load_env
  [ -n "${DATABASE_URL:-}" ] || { error "DATABASE_URL not set in .env"; exit 1; }

  local ts_json
  if ! ts_json=$(tailscale status --json 2>/dev/null); then
    error "tailscale status failed — is tailscaled running and logged in?"
    exit 1
  fi

  local sql
  sql=$(printf '%s' "$ts_json" | node "$STRAWBOSS_ROOT/scripts/tailscale-sync.mjs")
  if [ -z "$sql" ]; then
    warn "No tailscale data parsed (no peers?)."
    return 0
  fi
  printf '%s' "$sql" | psql "$DATABASE_URL" -X -q
  success "Tailscale status synced to devices table."
}

# @cmd fleet:tunnel "Open an ADB tunnel to a fleet phone by nickname over Tailscale"
cmd_fleet__tunnel() {
  header "ADB tunnel to fleet phone"
  local nickname="${1:-}"
  [ -n "$nickname" ] || { error "Usage: ./strawboss.sh fleet:tunnel \"<nickname>\""; exit 1; }
  _load_env
  [ -n "${DATABASE_URL:-}" ] || { error "DATABASE_URL not set in .env"; exit 1; }

  # Resolve adb (host SDK; Android SDK is root-owned per repo conventions).
  local adb_bin="adb"
  if ! command -v adb >/dev/null 2>&1; then
    _mobile_resolve_android_home 2>/dev/null || true
    if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
      adb_bin="$ANDROID_HOME/platform-tools/adb"
    else
      error "adb not found. Install it: sudo apt-get install -y android-tools-adb"
      exit 1
    fi
  fi

  # Normalize the argument to a Tailscale hostname label ([a-z0-9-]) — the same way the
  # backend sanitizes nicknames. This ALSO neutralizes any shell/SQL metacharacters, so the
  # accepted arg can be either the hostname ("combina-man") or a free nickname ("Combina MAN").
  local host
  host=$(printf '%s' "$nickname" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//; s/-*$//')
  if ! printf '%s' "$host" | grep -qE '^[a-z0-9-]+$'; then
    error "Invalid nickname/hostname (only A-Z, 0-9, space, _-. allowed)."
    exit 1
  fi

  # Primary: the tailnet IP the host sync wrote into the DB (keyed by sanitized hostname).
  local ip
  ip=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT tailscale_ip FROM devices WHERE tailscale_hostname = '$host' AND deleted_at IS NULL AND tailscale_ip IS NOT NULL ORDER BY tailscale_last_seen DESC NULLS LAST LIMIT 1" 2>/dev/null | tr -d '[:space:]')

  # Fallback: live `tailscale status` matched on the hostname.
  if [ -z "$ip" ] && command -v tailscale >/dev/null 2>&1; then
    ip=$(tailscale status --json 2>/dev/null | node -e '
      let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{
        let s; try { s = JSON.parse(r); } catch { return; }
        const ps = Object.values(s.Peer ?? {});
        const h = process.argv[1];
        const m = ps.find((p) => (p.HostName ?? "").toLowerCase() === h);
        process.stdout.write(m && Array.isArray(m.TailscaleIPs) ? (m.TailscaleIPs[0] ?? "") : "");
      });
    ' "$host")
  fi

  if [ -z "$ip" ]; then
    error "Could not resolve a tailnet IP for \"$nickname\"."
    echo -e "  ${DIM}Is Tailscale ON for this phone, and has 'fleet:tailscale-sync' run?${NC}"
    exit 1
  fi

  info "Connecting adb to ${BOLD}$nickname${NC} at ${BOLD}$ip:5555${NC} ..."
  # `adb connect` exits 0 even on "Connection refused" — must parse its output.
  local connect_out
  connect_out=$("$adb_bin" connect "$ip:5555" 2>&1)
  echo "  $connect_out"
  if ! printf '%s' "$connect_out" | grep -qiE 'connected to'; then
    error "adb connect failed."
    echo -e "  ${DIM}ADB-over-TCP must be enabled ONCE on the phone (USB): ./strawboss.sh fleet:enable-adb-tcp${NC}"
    echo -e "  ${DIM}(Android won't let any app — even Device Owner — flip adbd to TCP without a one-time USB step on non-rooted devices.)${NC}"
    exit 1
  fi
  success "Connected. Opening shell (Ctrl-D / 'exit' to leave; the tunnel stays until reboot)."
  echo ""
  "$adb_bin" -s "$ip:5555" shell || true
}

# @cmd fleet:status "List fleet phones with their Tailscale state"
cmd_fleet__status() {
  header "Fleet — Tailscale status"
  require_cmd psql
  _load_env
  [ -n "${DATABASE_URL:-}" ] || { error "DATABASE_URL not set in .env"; exit 1; }
  psql "$DATABASE_URL" -P pager=off -c "
    SELECT COALESCE(name, '(no nickname)')                       AS phone,
           CASE WHEN tailscale_online THEN 'ONLINE' ELSE 'off' END AS tailscale,
           tailscale_desired                                      AS desired,
           tailscale_ip                                           AS tailnet_ip,
           to_char(tailscale_last_seen, 'MM-DD HH24:MI')          AS ts_seen,
           to_char(last_seen_at, 'MM-DD HH24:MI')                 AS app_seen
    FROM devices
    WHERE deleted_at IS NULL
    ORDER BY organization_id NULLS FIRST, name NULLS LAST;"
}

# @cmd fleet:install-sync-timer "Install + start the systemd timer that runs fleet:tailscale-sync every 60s"
cmd_fleet__install__sync__timer() {
  header "Install systemd timer (fleet:tailscale-sync)"
  require_cmd systemctl
  local src="$STRAWBOSS_ROOT/deploy/systemd"
  [ -f "$src/strawboss-fleet-sync.service" ] || { error "Unit files missing under deploy/systemd/"; exit 1; }
  info "Copying unit files to /etc/systemd/system (needs sudo)..."
  sudo cp "$src/strawboss-fleet-sync.service" "$src/strawboss-fleet-sync.timer" /etc/systemd/system/ || { error "copy failed"; exit 1; }
  sudo systemctl daemon-reload
  sudo systemctl enable --now strawboss-fleet-sync.timer
  success "Timer installed + started — fleet:tailscale-sync runs every 60s."
  sudo systemctl status strawboss-fleet-sync.timer --no-pager 2>/dev/null | head -4 || true
  echo -e "  ${DIM}Logs: journalctl -u strawboss-fleet-sync.service -f${NC}"
}

# @cmd fleet:uninstall-sync-timer "Stop + remove the fleet:tailscale-sync systemd timer"
cmd_fleet__uninstall__sync__timer() {
  header "Uninstall systemd timer (fleet:tailscale-sync)"
  require_cmd systemctl
  sudo systemctl disable --now strawboss-fleet-sync.timer 2>/dev/null || true
  sudo rm -f /etc/systemd/system/strawboss-fleet-sync.service /etc/systemd/system/strawboss-fleet-sync.timer
  sudo systemctl daemon-reload
  success "Timer removed."
}

# @cmd fleet:enable-adb-tcp "One-time: enable ADB-over-TCP on a USB-connected phone"
cmd_fleet__enable__adb__tcp() {
  header "Enable ADB-over-TCP (one-time, USB)"
  local adb_bin="adb"
  if ! command -v adb >/dev/null 2>&1; then
    _mobile_resolve_android_home 2>/dev/null || true
    if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
      adb_bin="$ANDROID_HOME/platform-tools/adb"
    else
      error "adb not found. Install it: sudo apt-get install -y android-tools-adb"
      exit 1
    fi
  fi
  info "Connect the phone via USB (USB debugging on), then this enables TCP adb on :5555."
  "$adb_bin" devices
  if "$adb_bin" tcpip 5555; then
    success "ADB-over-TCP enabled on :5555."
    echo -e "  ${DIM}Now (phone on Tailscale): ./strawboss.sh fleet:tunnel \"<nickname>\"${NC}"
  else
    error "Failed — make sure exactly one USB device is connected & authorized."
  fi
  warn "Resets on reboot (Android security limit on non-rooted devices) — re-run after a phone restart."
}

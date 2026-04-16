#!/usr/bin/env bash
# ============================================================================
# _lib.sh — Cross-platform utilities, colors, and shared helpers
#
# Sourced by strawboss.sh before any category script.
# Provides: OS detection, colors, formatters, stat/port/size wrappers,
#           and common project helpers (_ensure_env, _load_env, etc.).
# ============================================================================

# ---------------------------------------------------------------------------
# OS Detection
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin*) STRAWBOSS_OS="macos" ;;
  *)       STRAWBOSS_OS="linux" ;;
esac

# ---------------------------------------------------------------------------
# Colors & Symbols
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  MAGENTA='\033[0;35m'
  CYAN='\033[0;36m'
  WHITE='\033[1;37m'
  GRAY='\033[0;90m'
  BOLD='\033[1m'
  DIM='\033[2m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' MAGENTA='' CYAN=''
  WHITE='' GRAY='' BOLD='' DIM='' NC=''
fi

# Unicode symbols
OK="${GREEN}\\u2714${NC}"
FAIL="${RED}\\u2718${NC}"
WARN="${YELLOW}\\u26A0${NC}"
ARROW="${CYAN}\\u25B6${NC}"
DOT="${GRAY}\\u2022${NC}"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
info()    { echo -e "  ${BLUE}\\u25CF${NC}  $*"; }
success() { echo -e "  ${GREEN}\\u2714${NC}  $*"; }
warn()    { echo -e "  ${YELLOW}\\u26A0${NC}  $*"; }
error()   { echo -e "  ${RED}\\u2718${NC}  $*" >&2; }

header() {
  echo ""
  echo -e "  ${BOLD}${CYAN}\\u250C\\u2500\\u2500 $* \\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500${NC}"
  echo ""
}

divider() {
  echo -e "  ${GRAY}\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500${NC}"
}

section() {
  echo ""
  echo -e "  ${BOLD}${WHITE}$*${NC}"
  echo ""
}

# Status line formatters
_ok()   { printf "  ${OK}  %-28s %s\\n" "$1" "${2:-}"; }
_fail() { printf "  ${FAIL}  %-28s %s\\n" "$1" "${2:-}"; }
_warn() { printf "  ${WARN}  %-28s %s\\n" "$1" "${2:-}"; }
_info() { printf "  ${DOT}  %-28s %s\\n" "$1" "${2:-}"; }

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Cross-platform wrappers
# ---------------------------------------------------------------------------

# File modification time (epoch seconds)
_stat_mtime() {
  if [ "$STRAWBOSS_OS" = "macos" ]; then
    stat -f %m "$1" 2>/dev/null || echo "0"
  else
    stat -c %Y "$1" 2>/dev/null || echo "0"
  fi
}

# File size in bytes
_stat_size() {
  if [ "$STRAWBOSS_OS" = "macos" ]; then
    stat -f %z "$1" 2>/dev/null || echo "0"
  else
    stat -c %s "$1" 2>/dev/null || echo "0"
  fi
}

# Directory size in bytes
_dir_bytes() {
  if [ ! -d "$1" ]; then
    echo "0"
    return
  fi
  if [ "$STRAWBOSS_OS" = "macos" ]; then
    # macOS du doesn't support -b; use -k and multiply
    local kb
    kb=$(du -sk "$1" 2>/dev/null | cut -f1)
    echo $(( ${kb:-0} * 1024 ))
  else
    du -sb "$1" 2>/dev/null | cut -f1 || echo "0"
  fi
}

# Human-readable byte sizes (uses awk, no bc dependency)
_human_size() {
  local bytes="${1:-0}"
  echo "$bytes" | awk '{
    if      ($1 >= 1073741824) printf "%.1f GB", $1/1073741824
    else if ($1 >= 1048576)    printf "%.0f MB", $1/1048576
    else if ($1 >= 1024)       printf "%.0f KB", $1/1024
    else                       printf "%d B", $1
  }'
}

# Check if a TCP port is listening
_port_open() {
  local port="$1"
  if [ "$STRAWBOSS_OS" = "macos" ]; then
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null && return 0
  else
    if command -v ss &>/dev/null; then
      ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0
    fi
    # Fallback to lsof on Linux too
    if command -v lsof &>/dev/null; then
      lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null && return 0
    fi
  fi
  return 1
}

# Get PID of process on a port
_port_process() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1
  fi
}

# Kill processes on a port
_kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    warn "Port $port in use — killing PID(s): $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.4
  fi
}

# Time-ago string from epoch timestamp
_time_ago() {
  local ts="$1"
  [ "$ts" -le 0 ] 2>/dev/null && return
  local now diff
  now=$(date +%s)
  diff=$(( now - ts ))
  if   (( diff < 60 ));    then echo "${DIM}just now${NC}"
  elif (( diff < 3600 ));  then echo "${DIM}$(( diff / 60 ))m ago${NC}"
  elif (( diff < 86400 )); then echo "${DIM}$(( diff / 3600 ))h ago${NC}"
  else echo "${DIM}$(( diff / 86400 ))d ago${NC}"
  fi
}

# ---------------------------------------------------------------------------
# Project helpers
# ---------------------------------------------------------------------------

_free_dev_ports() {
  _kill_port 3000   # admin-web (Next.js)
  _kill_port 3001   # backend (NestJS)
  _kill_port 19000  # Expo dev server
  _kill_port 19001  # Expo Metro bundler
  _kill_port 8081   # Metro fallback
}

_ensure_env() {
  if [ ! -f "$STRAWBOSS_ROOT/.env" ] && [ -f "$STRAWBOSS_ROOT/.env.example" ]; then
    warn ".env not found — copying from .env.example. Edit it with your Supabase credentials."
    cp "$STRAWBOSS_ROOT/.env.example" "$STRAWBOSS_ROOT/.env"
  fi
}

_load_env() {
  _ensure_env
  if [ ! -f "$STRAWBOSS_ROOT/.env" ]; then
    error "No .env file. Create one from .env.example first."
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "$STRAWBOSS_ROOT/.env"
  set +a
}

_build_packages() {
  info "Building shared packages..."
  pnpm --filter @strawboss/types build
  pnpm --filter @strawboss/validation build
  pnpm --filter @strawboss/ui-tokens build
  pnpm --filter @strawboss/domain build
  pnpm --filter @strawboss/api build
  success "Shared packages built."
}

_ensure_dev_redis() {
  if ! command -v docker &>/dev/null; then
    warn "Docker not found — install Redis on localhost:6379 yourself."
    return
  fi
  if ! docker info &>/dev/null 2>&1; then
    warn "Docker daemon not running — Redis unavailable."
    return
  fi
  info "Starting Redis for BullMQ..."
  docker compose up -d redis 2>/dev/null
  success "Redis: localhost:6379"
}

_validate_prod_env() {
  local missing=()
  for var in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL \
             NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
             NEXT_PUBLIC_API_URL; do
    [ -z "${!var:-}" ] && missing+=("$var")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required .env variables: ${missing[*]}"
    exit 1
  fi
}

# Resolve ANDROID_HOME from env, .env, or common paths
_mobile_resolve_android_home() {
  if [ -f "$STRAWBOSS_ROOT/.env" ] && [ -z "${ANDROID_HOME:-}" ]; then
    local line
    line=$(grep -E '^[[:space:]]*ANDROID_HOME=' "$STRAWBOSS_ROOT/.env" 2>/dev/null | tail -1 || true)
    if [ -n "$line" ]; then
      export ANDROID_HOME="${line#*=}"
      ANDROID_HOME="${ANDROID_HOME%\"}"
      ANDROID_HOME="${ANDROID_HOME#\"}"
      ANDROID_HOME="${ANDROID_HOME%\'}"
      ANDROID_HOME="${ANDROID_HOME#\'}"
    fi
  fi
  if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/platform-tools" ]; then
    return 0
  fi
  local candidates=(
    "${ANDROID_SDK_ROOT:-}"
    "$HOME/Android/Sdk"
    "$HOME/Library/Android/sdk"
    "/root/Android/Sdk"
    "/opt/android-sdk"
    "/usr/lib/android-sdk"
  )
  local d
  for d in "${candidates[@]}"; do
    [ -z "$d" ] && continue
    if [ -d "$d/platform-tools" ]; then
      export ANDROID_HOME="$d"
      return 0
    fi
  done
  return 1
}

#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# strawboss.sh — StrawBoss monorepo control script
#
# Primary commands:
#   ./strawboss.sh setup   — first-time install: deps + .env + DB + packages
#   ./strawboss.sh dev     — start local dev servers (localhost:3000 / :3001)
#   ./strawboss.sh prod    — build + start production (https://nortiauno.com)
#   ./strawboss.sh stop    — stop everything (dev processes + Docker)
#   ./strawboss.sh mobile-build       — Android APK via Expo EAS (cloud)
#   ./strawboss.sh mobile-build-local — Android APK via local Gradle (needs SDK)
#   ./strawboss.sh logs | logs:error | logs:flow | logs:mobile | logs:clean
#
# Run ./strawboss.sh help for the full command list.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[err]${NC}   $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}── $* ──${NC}\n"; }

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is required but not installed."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

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

_free_dev_ports() {
  _kill_port 3000   # admin-web (Next.js)
  _kill_port 3001   # backend (NestJS)
  _kill_port 19000  # Expo dev server
  _kill_port 19001  # Expo Metro bundler
  _kill_port 8081   # Metro fallback
}

_ensure_env() {
  if [ ! -f .env ] && [ -f .env.example ]; then
    warn ".env not found — copying from .env.example. Edit it with your Supabase credentials."
    cp .env.example .env
  fi
}

_load_env() {
  _ensure_env
  if [ ! -f .env ]; then
    error "No .env file. Create one from .env.example first."
    exit 1
  fi
  # shellcheck disable=SC1091
  source .env
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
  if ! docker info &>/dev/null; then
    warn "Docker daemon not running — Redis unavailable. Backend BullMQ will fail."
    return
  fi
  info "Starting Redis for BullMQ..."
  docker compose up -d redis
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

_ssl_init() {
  info "Starting nginx for ACME HTTP-01 challenge..."
  docker compose up -d nginx
  sleep 2

  # Remove the self-signed placeholder before certbot runs so it doesn't
  # create a nortiauno.com-0001 duplicate. Nginx keeps the cert in memory
  # and will reload with the real cert below.
  docker compose run --rm --entrypoint sh certbot -c \
    "rm -rf /etc/letsencrypt/live/nortiauno.com /etc/letsencrypt/archive/nortiauno.com" \
    2>/dev/null || true

  info "Requesting Let's Encrypt certificate..."
  docker compose run --rm --entrypoint certbot certbot certonly \
    --webroot \
    -w /var/www/certbot \
    -d nortiauno.com \
    -d www.nortiauno.com \
    --agree-tos \
    --no-eff-email \
    ${CERTBOT_EMAIL:+--email "$CERTBOT_EMAIL"}

  info "Reloading nginx with the new certificate..."
  docker compose exec nginx nginx -s reload
  success "SSL certificate issued — https://nortiauno.com is live."
}

_certs_exist() {
  # Check for Let's Encrypt renewal config, NOT the cert file itself.
  # The nginx entrypoint creates a self-signed placeholder at the same cert path,
  # so checking fullchain.pem would return true even before ssl:init runs.
  docker compose run --rm --entrypoint="" certbot \
    test -f /etc/letsencrypt/renewal/nortiauno.com.conf 2>/dev/null
}

# ---------------------------------------------------------------------------
# PRIMARY COMMANDS
# ---------------------------------------------------------------------------

# setup — install everything needed to start working
cmd_setup() {
  header "StrawBoss Setup"
  require_cmd pnpm

  _ensure_env

  info "Installing dependencies..."
  pnpm install
  success "Dependencies installed."

  _build_packages

  # Run DB migrations if DATABASE_URL is available.
  if [ -f .env ]; then
    # shellcheck disable=SC1091
    source .env
    if [ -n "${DATABASE_URL:-}" ]; then
      info "Applying database migrations..."
      for migration in supabase/migrations/*.sql; do
        filename="$(basename "$migration")"
        printf "  applying %-45s" "$filename..."
        if psql "$DATABASE_URL" -f "$migration" &>/dev/null; then
          echo -e "${GREEN}ok${NC}"
        else
          echo -e "${YELLOW}skipped (already applied or error)${NC}"
        fi
      done
      success "Migrations applied."
    else
      warn "DATABASE_URL not set — skipping migrations. Run './strawboss.sh db:migrate' manually."
    fi
  fi

  echo ""
  success "Setup complete."
  info "  Edit .env with your Supabase credentials if you haven't already."
  info "  Then run:  ./strawboss.sh dev"
}

# dev — start local development servers
cmd_dev() {
  header "Starting Dev"
  require_cmd pnpm

  _free_dev_ports
  _ensure_dev_redis
  _build_packages

  echo ""
  info "Backend:  http://localhost:3001/api/v1"
  info "Admin:    http://localhost:3000"
  echo ""

  pnpm --filter @strawboss/backend --filter @strawboss/admin-web dev
}

# prod — build images and start production stack
cmd_prod() {
  header "Starting Production"
  require_cmd docker
  require_cmd pnpm

  _load_env
  _validate_prod_env

  info "Installing dependencies (frozen lockfile)..."
  pnpm install --frozen-lockfile
  success "Dependencies installed."

  _build_packages

  info "Building Docker images..."
  docker compose build \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL"
  success "Docker images built."

  info "Starting all services..."
  docker compose up -d
  success "Services started."

  # Issue Let's Encrypt cert on first deploy (nginx starts with a self-signed
  # placeholder, so port 80 is already available for the ACME challenge).
  if ! _certs_exist; then
    warn "No Let's Encrypt cert found — running ssl:init..."
    _ssl_init
  else
    info "SSL certificate already present."
  fi

  echo ""
  success "Production is live."
  info "  https://nortiauno.com"
  info "  https://nortiauno.com/api/v1"
}

# stop — stop dev processes and Docker services
cmd_stop() {
  header "Stopping StrawBoss"

  info "Killing dev server processes..."
  _free_dev_ports
  success "Dev processes stopped."

  if command -v docker &>/dev/null && docker info &>/dev/null; then
    info "Stopping Docker services..."
    docker compose down
    success "Docker services stopped."
  fi
}

# Resolve ANDROID_HOME: env, .env, then common install paths.
_mobile_resolve_android_home() {
  if [ -f "$SCRIPT_DIR/.env" ] && [ -z "${ANDROID_HOME:-}" ]; then
    local line
    line=$(grep -E '^[[:space:]]*ANDROID_HOME=' "$SCRIPT_DIR/.env" 2>/dev/null | tail -1 || true)
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
    "/root/Android/Sdk"
    "/opt/android-sdk"
    "/usr/lib/android-sdk"
  )
  local d
  for d in "${candidates[@]}"; do
    [ -z "$d" ] && continue
    if [ -d "$d/platform-tools" ]; then
      export ANDROID_HOME="$d"
      info "Using Android SDK: ANDROID_HOME=$ANDROID_HOME"
      return 0
    fi
  done
  return 1
}

# mobile-build — Android APK via Expo Application Services (cloud)
cmd_mobile_build() {
  header "Mobile Android APK (EAS Build)"
  require_cmd pnpm

  local mobile_dir="$SCRIPT_DIR/apps/mobile"
  if [ ! -d "$mobile_dir" ]; then
    error "apps/mobile not found."
    exit 1
  fi
  if [ ! -f "$mobile_dir/eas.json" ]; then
    error "Missing apps/mobile/eas.json"
    exit 1
  fi

  info "Runs Expo EAS in the cloud (profile: apk → installable .apk)."
  info "First time: cd apps/mobile && pnpm dlx eas-cli@latest login && pnpm dlx eas-cli@latest init"
  info "CI: set EXPO_TOKEN (expo.dev account settings → Access tokens)."
  echo ""

  (
    cd "$mobile_dir"
    pnpm dlx eas-cli@latest build --platform android --profile apk "$@"
  )
}

# mobile-build-local — Android APK on this machine (expo prebuild + Gradle)
# Requires: JDK 17+, ANDROID_HOME, Android SDK platform-tools + build-tools.
# Usage: mobile-build-local [debug|release]   (default: debug — no keystore needed)
cmd_mobile_build_local() {
  header "Mobile Android APK (local Gradle)"
  require_cmd pnpm

  local variant="${1:-debug}"
  if [ "$variant" != "debug" ] && [ "$variant" != "release" ]; then
    error "Invalid variant '$variant'. Use: mobile-build-local [debug|release]"
    exit 1
  fi

  if ! _mobile_resolve_android_home; then
    error "Android SDK not found. Install Command-line tools + platform-tools, or set ANDROID_HOME in .env"
    info "Typical path: \$HOME/Android/Sdk (needs platform-tools/ directory)"
    exit 1
  fi
  if ! command -v java &>/dev/null; then
    error "java not found. Install JDK 17+ (e.g. temurin-17)."
    exit 1
  fi

  local mobile_dir="$SCRIPT_DIR/apps/mobile"
  if [ ! -d "$mobile_dir" ]; then
    error "apps/mobile not found."
    exit 1
  fi

  info "Building workspace packages used by mobile..."
  pnpm --filter @strawboss/types build
  pnpm --filter @strawboss/validation build
  pnpm --filter @strawboss/ui-tokens build
  pnpm --filter @strawboss/api build

  info "expo prebuild --platform android (generates/updates android/)..."
  (
    cd "$mobile_dir"
    pnpm exec expo prebuild --platform android
  )

  local gradle_task="assembleDebug"
  local out_sub="debug"
  if [ "$variant" = "release" ]; then
    gradle_task="assembleRelease"
    out_sub="release"
    warn "Release builds need a signing config in android/; Gradle may fail without it."
  fi

  info "Gradle: ./gradlew $gradle_task"
  chmod +x "$mobile_dir/android/gradlew" 2>/dev/null || true
  (
    cd "$mobile_dir/android"
    ./gradlew "$gradle_task"
  )

  success "Done."
  info "APK: $mobile_dir/android/app/build/outputs/apk/$out_sub/"
  info "Typical file: app-${variant}.apk (name may vary)"
}

# ---------------------------------------------------------------------------
# LOWER-LEVEL COMMANDS (power users / CI)
# ---------------------------------------------------------------------------

cmd_install() {
  header "Installing dependencies"
  require_cmd pnpm
  pnpm install
  success "Dependencies installed."
}

cmd_build() {
  local target="${1:-all}"
  header "Building: $target"
  require_cmd pnpm

  case "$target" in
    types)      pnpm --filter @strawboss/types build ;;
    validation) pnpm --filter @strawboss/types build && pnpm --filter @strawboss/validation build ;;
    ui-tokens)  pnpm --filter @strawboss/ui-tokens build ;;
    domain)     pnpm --filter @strawboss/types build && pnpm --filter @strawboss/domain build ;;
    api)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/api build
      ;;
    backend)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/domain build
      pnpm --filter @strawboss/backend build
      ;;
    admin)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/ui-tokens build
      pnpm --filter @strawboss/api build
      pnpm --filter @strawboss/admin-web build
      ;;
    packages)
      _build_packages
      ;;
    all)
      _build_packages
      pnpm --filter @strawboss/backend build
      pnpm --filter @strawboss/admin-web build
      ;;
    *)
      error "Unknown build target: $target"
      echo "Targets: types | validation | ui-tokens | domain | api | backend | admin | packages | all"
      exit 1
      ;;
  esac

  success "Build complete: $target"
}

cmd_typecheck() {
  local target="${1:-all}"
  header "Typechecking: $target"
  require_cmd pnpm

  local failed=0
  _run_check() {
    local name="$1" filter="$2"
    printf "  %-20s" "$name"
    if pnpm --filter "$filter" typecheck 2>/dev/null; then
      echo -e "${GREEN}pass${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      failed=1
    fi
  }

  case "$target" in
    all)
      _run_check "types"      "@strawboss/types"
      _run_check "validation" "@strawboss/validation"
      _run_check "ui-tokens"  "@strawboss/ui-tokens"
      _run_check "domain"     "@strawboss/domain"
      _run_check "api"        "@strawboss/api"
      _run_check "backend"    "@strawboss/backend"
      _run_check "admin-web"  "@strawboss/admin-web"
      _run_check "mobile"     "@strawboss/mobile"
      ;;
    *)
      pnpm --filter "@strawboss/$target" typecheck
      ;;
  esac

  [ "$failed" -eq 0 ] && success "All typechecks passed." || { error "Some typechecks failed."; exit 1; }
}

cmd_lint() {
  header "Linting"
  require_cmd pnpm
  pnpm lint
  success "Lint passed."
}

cmd_clean() {
  header "Cleaning build artifacts"
  local dirs=(
    "packages/types/dist" "packages/validation/dist" "packages/ui-tokens/dist"
    "packages/domain/dist" "packages/api/dist"
    "backend/service/dist" "apps/admin-web/.next"
  )
  for dir in "${dirs[@]}"; do
    [ -d "$dir" ] && rm -rf "$dir" && info "Removed $dir"
  done
  find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true
  rm -rf .turbo 2>/dev/null || true
  success "Clean complete."
}

cmd_clean_all() {
  cmd_clean
  header "Removing node_modules"
  find . -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  success "node_modules removed. Run './strawboss.sh setup' to reinstall."
}

cmd_docker_build() {
  header "Building Docker images"
  require_cmd docker
  _load_env
  docker compose build "$@"
  success "Docker images built."
}

cmd_docker_up() {
  header "Starting Docker services"
  require_cmd docker
  _ensure_env
  docker compose up -d "$@"
  success "Docker services started."
}

cmd_docker_down() {
  header "Stopping Docker services"
  require_cmd docker
  docker compose down "$@"
  success "Docker services stopped."
}

cmd_docker_logs() {
  require_cmd docker
  docker compose logs -f "$@"
}

cmd_ssl_init() {
  header "Issuing Let's Encrypt certificate"
  require_cmd docker
  _load_env
  _ssl_init
}

cmd_db_migrate() {
  header "Running database migrations"
  _load_env
  if [ -z "${DATABASE_URL:-}" ]; then
    error "DATABASE_URL not set in .env"
    exit 1
  fi
  info "Applying migrations to: ${DATABASE_URL%%@*}@..."
  for migration in supabase/migrations/*.sql; do
    filename="$(basename "$migration")"
    info "Applying $filename..."
    psql "$DATABASE_URL" -f "$migration" 2>&1 || warn "$filename may already be applied. Continuing..."
  done
  success "Migrations applied."
}

cmd_db_seed() {
  header "Seeding database"
  _load_env
  if [ -z "${DATABASE_URL:-}" ]; then
    error "DATABASE_URL not set in .env"
    exit 1
  fi
  psql "$DATABASE_URL" -f supabase/seed.sql
  success "Database seeded."
}

cmd_db_reset() {
  cmd_db_migrate
  cmd_db_seed
  success "Database reset complete."
}

cmd_status() {
  header "StrawBoss Status"

  echo -e "${BOLD}Packages:${NC}"
  for pkg in "types:packages/types/dist" "validation:packages/validation/dist" \
             "ui-tokens:packages/ui-tokens/dist" "domain:packages/domain/dist" \
             "api:packages/api/dist"; do
    local name="${pkg%%:*}" dir="${pkg#*:}"
    [ -d "$dir" ] \
      && printf "  %-16s ${GREEN}built${NC}\n" "$name" \
      || printf "  %-16s ${YELLOW}not built${NC}\n" "$name"
  done

  echo ""
  echo -e "${BOLD}Apps:${NC}"
  [ -d "backend/service/dist" ] \
    && printf "  %-16s ${GREEN}built${NC}\n" "backend" \
    || printf "  %-16s ${YELLOW}not built${NC}\n" "backend"
  [ -d "apps/admin-web/.next" ] \
    && printf "  %-16s ${GREEN}built${NC}\n" "admin-web" \
    || printf "  %-16s ${YELLOW}not built${NC}\n" "admin-web"

  echo ""
  echo -e "${BOLD}Docker:${NC}"
  if command -v docker &>/dev/null && docker compose ps --status running 2>/dev/null | grep -q .; then
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
  else
    echo "  No Docker services running."
  fi

  echo ""
  echo -e "${BOLD}Environment:${NC}"
  [ -f .env ] \
    && printf "  .env             ${GREEN}exists${NC}\n" \
    || printf "  .env             ${RED}missing${NC}  (copy from .env.example)\n"
  [ -d node_modules ] \
    && printf "  node_modules     ${GREEN}installed${NC}\n" \
    || printf "  node_modules     ${RED}missing${NC}  (run setup)\n"
}

_logs_today_path() {
  # $1 = e.g. web/all, web/error, mobile/all
  echo "$SCRIPT_DIR/logs/$1/$(date +%Y-%m-%d).log"
}

cmd_logs() {
  local rel="${1:-web/all}"
  local f
  f="$(_logs_today_path "$rel")"
  if [ ! -f "$f" ]; then
    warn "No log file yet: $f"
    info "Start the backend (or admin) to generate logs; ensure LOG_ROOT points at ./logs if needed."
    exit 1
  fi
  tail -f "$f"
}

cmd_logs_clean() {
  if [ -d "$SCRIPT_DIR/logs" ]; then
    rm -rf "${SCRIPT_DIR:?}/logs"/*
    success "Cleared $SCRIPT_DIR/logs/"
  else
    info "No logs directory yet."
  fi
}

cmd_help() {
  echo -e "${BOLD}${CYAN}"
  echo "  _____ _                   ____                 "
  echo " / ____| |                 |  _ \\                "
  echo "| (___ | |_ _ __ __ ___  _| |_) | ___  ___ ___  "
  echo " \\___ \\| __| '__/ _\` \\ \\/ /  _ < / _ \\/ __/ __| "
  echo " ____) | |_| | | (_| |>  <| |_) | (_) \\__ \\__ \\ "
  echo "|_____/ \\__|_|  \\__,_/_/\\_\\____/ \\___/|___/___/ "
  echo -e "${NC}"
  echo -e "${BOLD}Usage:${NC} ./strawboss.sh <command>"
  echo ""

  echo -e "${BOLD}── Main commands ────────────────────────────────────────${NC}"
  echo "  setup    Install deps, copy .env, migrate DB, build packages"
  echo "  dev      Start local dev servers  (localhost:3000 / :3001)"
  echo "  prod     Build images + start production  (https://nortiauno.com)"
  echo "  stop     Stop dev processes and all Docker services"
  echo ""

  echo -e "${BOLD}── Mobile ───────────────────────────────────────────────${NC}"
  echo "  mobile-build [args]       Android APK via Expo EAS (cloud; eas login + eas init)"
  echo "  mobile-build-local [kind] Local APK: expo prebuild + Gradle (JDK 17, ANDROID_HOME)"
  echo "                            kind = debug (default) | release"
  echo ""

  echo -e "${BOLD}── Dev tools ────────────────────────────────────────────${NC}"
  echo "  build [target]       Build packages/apps"
  echo "                       Targets: packages | all | types | validation |"
  echo "                                ui-tokens | domain | api | backend | admin"
  echo "  typecheck [target]   TypeScript type check (all or a package name)"
  echo "  lint                 ESLint across all packages"
  echo "  clean                Remove dist/ and .next/ build artifacts"
  echo "  clean:all            Remove dist/ AND node_modules/"
  echo "  status               Show build + Docker service status"
  echo "  logs                 tail -f today's logs/web/all/YYYY-MM-DD.log"
  echo "  logs:error           tail -f logs/web/error/ (today)"
  echo "  logs:flow            tail -f logs/web/flow/ (today)"
  echo "  logs:mobile          tail -f logs/mobile/all/ (today; server-ingested)"
  echo "  logs:clean           rm -rf logs/*"
  echo ""

  echo -e "${BOLD}── Database ─────────────────────────────────────────────${NC}"
  echo "  db:migrate           Apply supabase/migrations/*.sql"
  echo "  db:seed              Run supabase/seed.sql"
  echo "  db:reset             Migrate + seed"
  echo ""

  echo -e "${BOLD}── Docker (low-level) ───────────────────────────────────${NC}"
  echo "  docker:build         Build Docker images"
  echo "  docker:up [svc...]   Start specific services"
  echo "  docker:down [svc...] Stop specific services"
  echo "  docker:logs [svc...] Tail service logs"
  echo "  ssl:init             Issue Let's Encrypt cert for nortiauno.com"
  echo ""

  echo -e "${BOLD}── Typical workflows ────────────────────────────────────${NC}"
  echo "  First time:          cp .env.example .env  →  edit .env  →  ./strawboss.sh setup"
  echo "  Daily dev:           ./strawboss.sh dev"
  echo "  Deploy to prod:      ./strawboss.sh prod"
  echo "  Stop everything:     ./strawboss.sh stop"
  echo ""
}

# ---------------------------------------------------------------------------
# Command router
# ---------------------------------------------------------------------------
COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
  # Primary
  setup)          cmd_setup "$@" ;;
  dev)            cmd_dev "$@" ;;
  prod)           cmd_prod "$@" ;;
  stop)           cmd_stop "$@" ;;
  mobile-build)        cmd_mobile_build "$@" ;;
  mobile-build-local)  cmd_mobile_build_local "$@" ;;
  # Dev tools
  install)        cmd_install "$@" ;;
  build)          cmd_build "$@" ;;
  typecheck)      cmd_typecheck "$@" ;;
  lint)           cmd_lint "$@" ;;
  clean)          cmd_clean "$@" ;;
  clean:all)      cmd_clean_all "$@" ;;
  status)         cmd_status "$@" ;;
  logs)           cmd_logs web/all ;;
  logs:error)     cmd_logs web/error ;;
  logs:flow)      cmd_logs web/flow ;;
  logs:mobile)    cmd_logs mobile/all ;;
  logs:clean)     cmd_logs_clean "$@" ;;
  # Database
  db:migrate)     cmd_db_migrate "$@" ;;
  db:seed)        cmd_db_seed "$@" ;;
  db:reset)       cmd_db_reset "$@" ;;
  # Docker
  docker:build)   cmd_docker_build "$@" ;;
  docker:up)      cmd_docker_up "$@" ;;
  docker:down)    cmd_docker_down "$@" ;;
  docker:logs)    cmd_docker_logs "$@" ;;
  ssl:init)       cmd_ssl_init "$@" ;;
  # Help
  help|--help|-h) cmd_help "$@" ;;
  *)
    error "Unknown command: $COMMAND"
    echo "Run './strawboss.sh help' for usage."
    exit 1
    ;;
esac

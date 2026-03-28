#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# strawboss.sh — StrawBoss monorepo control script
# ============================================================================
#
# Usage:  ./strawboss.sh <command> [options]
#
# Run ./strawboss.sh help for full command list.
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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

# Kill any process listening on a given TCP port (silently ignores if nothing is there).
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    warn "Port $port in use — killing PID(s): $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.4
  fi
}

# Free all ports used by StrawBoss dev servers.
free_dev_ports() {
  kill_port 3000   # admin-web (Next.js)
  kill_port 3001   # backend (NestJS)
  kill_port 19000  # Expo dev server
  kill_port 19001  # Expo Metro bundler
  kill_port 8081   # Metro fallback
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
ensure_env() {
  if [ ! -f .env ] && [ -f .env.example ]; then
    warn ".env not found. Copying from .env.example — edit it with your Supabase credentials."
    cp .env.example .env
  fi
}

# ---------------------------------------------------------------------------
# Commands
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
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/ui-tokens build
      pnpm --filter @strawboss/domain build
      pnpm --filter @strawboss/api build
      ;;
    all)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/ui-tokens build
      pnpm --filter @strawboss/domain build
      pnpm --filter @strawboss/api build
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

cmd_dev() {
  local target="${1:-all}"

  header "Starting dev: $target"
  require_cmd pnpm

  # Free ports before starting anything so stale processes never block startup.
  case "$target" in
    backend)        kill_port 3001 ;;
    admin)          kill_port 3000 ;;
    mobile)         kill_port 19000; kill_port 19001; kill_port 8081 ;;
    all)            free_dev_ports ;;
  esac

  # Build shared packages first (they don't have dev watchers that work well)
  info "Building shared packages..."
  cmd_build packages 2>/dev/null

  case "$target" in
    backend)
      info "Starting backend on :3001..."
      pnpm --filter @strawboss/backend dev
      ;;
    admin)
      info "Starting admin dashboard on :3000..."
      pnpm --filter @strawboss/admin-web dev
      ;;
    mobile)
      info "Starting Expo dev server..."
      pnpm --filter @strawboss/mobile dev
      ;;
    all)
      info "Starting backend + admin in parallel..."
      info "Backend:  http://localhost:3001"
      info "Admin:    http://localhost:3000"
      echo ""
      pnpm --filter @strawboss/backend --filter @strawboss/admin-web dev
      ;;
    *)
      error "Unknown dev target: $target"
      echo "Targets: backend | admin | mobile | all"
      exit 1
      ;;
  esac
}

cmd_typecheck() {
  local target="${1:-all}"

  header "Typechecking: $target"
  require_cmd pnpm

  local failed=0

  run_check() {
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
      run_check "types"       "@strawboss/types"
      run_check "validation"  "@strawboss/validation"
      run_check "ui-tokens"   "@strawboss/ui-tokens"
      run_check "domain"      "@strawboss/domain"
      run_check "api"         "@strawboss/api"
      run_check "backend"     "@strawboss/backend"
      run_check "admin-web"   "@strawboss/admin-web"
      run_check "mobile"      "@strawboss/mobile"
      ;;
    *)
      pnpm --filter "@strawboss/$target" typecheck
      ;;
  esac

  if [ "$failed" -eq 0 ]; then
    success "All typechecks passed."
  else
    error "Some typechecks failed."
    exit 1
  fi
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
    "packages/types/dist"
    "packages/validation/dist"
    "packages/ui-tokens/dist"
    "packages/domain/dist"
    "packages/api/dist"
    "backend/service/dist"
    "apps/admin-web/.next"
  )

  for dir in "${dirs[@]}"; do
    if [ -d "$dir" ]; then
      rm -rf "$dir"
      info "Removed $dir"
    fi
  done

  # Remove tsbuildinfo files
  find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true
  # Remove turbo cache
  rm -rf .turbo 2>/dev/null || true

  success "Clean complete."
}

cmd_clean_all() {
  cmd_clean
  header "Removing node_modules"

  find . -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true

  success "All node_modules removed. Run './strawboss.sh install' to reinstall."
}

cmd_docker_build() {
  header "Building Docker images"
  require_cmd docker
  ensure_env

  docker compose build "$@"
  success "Docker images built."
}

cmd_docker_up() {
  header "Starting Docker services"
  require_cmd docker
  ensure_env

  # Free ports so Docker can bind them even if dev servers are still running.
  free_dev_ports

  docker compose up -d "$@"
  echo ""
  info "Services:"
  info "  Admin dashboard:  http://localhost:3000"
  info "  Backend API:      http://localhost:3001/api/v1"
  info "  Redis:            localhost:6379"
  echo ""
  success "All services running."
}

cmd_docker_down() {
  header "Stopping Docker services"
  require_cmd docker
  docker compose down "$@"
  success "Services stopped."
}

cmd_docker_logs() {
  require_cmd docker
  docker compose logs -f "$@"
}

cmd_db_migrate() {
  header "Running database migrations"
  ensure_env

  if [ ! -f .env ]; then
    error "No .env file found. Create one from .env.example first."
    exit 1
  fi

  # shellcheck disable=SC1091
  source .env

  if [ -z "${DATABASE_URL:-}" ]; then
    error "DATABASE_URL not set in .env"
    exit 1
  fi

  info "Applying migrations to: ${DATABASE_URL%%@*}@..."

  for migration in supabase/migrations/*.sql; do
    filename="$(basename "$migration")"
    info "Applying $filename..."
    psql "$DATABASE_URL" -f "$migration" 2>&1 || {
      warn "$filename may have already been applied (or failed). Continuing..."
    }
  done

  success "Migrations applied."
}

cmd_db_seed() {
  header "Seeding database"
  ensure_env

  # shellcheck disable=SC1091
  source .env

  if [ -z "${DATABASE_URL:-}" ]; then
    error "DATABASE_URL not set in .env"
    exit 1
  fi

  info "Running seed.sql..."
  psql "$DATABASE_URL" -f supabase/seed.sql

  success "Database seeded."
}

cmd_db_reset() {
  header "Resetting database (migrate + seed)"
  cmd_db_migrate
  cmd_db_seed
  success "Database reset complete."
}

cmd_status() {
  header "StrawBoss Project Status"

  echo -e "${BOLD}Packages:${NC}"
  local packages=(
    "types:packages/types/dist"
    "validation:packages/validation/dist"
    "ui-tokens:packages/ui-tokens/dist"
    "domain:packages/domain/dist"
    "api:packages/api/dist"
  )
  for pkg in "${packages[@]}"; do
    local name="${pkg%%:*}" dir="${pkg#*:}"
    if [ -d "$dir" ]; then
      printf "  %-16s ${GREEN}built${NC}\n" "$name"
    else
      printf "  %-16s ${YELLOW}not built${NC}\n" "$name"
    fi
  done

  echo ""
  echo -e "${BOLD}Apps:${NC}"
  if [ -d "backend/service/dist" ]; then
    printf "  %-16s ${GREEN}built${NC}\n" "backend"
  else
    printf "  %-16s ${YELLOW}not built${NC}\n" "backend"
  fi
  if [ -d "apps/admin-web/.next" ]; then
    printf "  %-16s ${GREEN}built${NC}\n" "admin-web"
  else
    printf "  %-16s ${YELLOW}not built${NC}\n" "admin-web"
  fi

  echo ""
  echo -e "${BOLD}Docker:${NC}"
  if command -v docker &>/dev/null && docker compose ps --status running 2>/dev/null | grep -q .; then
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
  else
    echo "  No Docker services running."
  fi

  echo ""
  echo -e "${BOLD}Environment:${NC}"
  if [ -f .env ]; then
    printf "  .env             ${GREEN}exists${NC}\n"
  else
    printf "  .env             ${RED}missing${NC}  (copy from .env.example)\n"
  fi

  echo ""
  echo -e "${BOLD}Node modules:${NC}"
  if [ -d node_modules ]; then
    printf "  node_modules     ${GREEN}installed${NC}\n"
  else
    printf "  node_modules     ${RED}not installed${NC}  (run ./strawboss.sh install)\n"
  fi
}

cmd_tree() {
  header "Project Structure"
  cat <<'TREE'
strawboss/
  apps/
    admin-web/           Next.js 15 admin dashboard
    mobile/              Expo React Native mobile app
  packages/
    types/               Shared TypeScript types & enums
    validation/          Zod validation schemas
    domain/              Business logic & XState trip machine
    api/                 API client & React Query hooks
    ui-tokens/           Design system tokens
  backend/
    service/             NestJS + Fastify backend API
  supabase/
    migrations/          PostgreSQL migration files (00001-00008)
    seed.sql             Development seed data
  docker-compose.yml     Docker orchestration
  Dockerfile.backend     Backend Docker image
  Dockerfile.admin       Admin dashboard Docker image
TREE
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
  echo -e "${BOLD}Usage:${NC} ./strawboss.sh <command> [options]"
  echo ""
  echo -e "${BOLD}Setup:${NC}"
  echo "  install                     Install all dependencies (pnpm install)"
  echo "  status                      Show project build/service status"
  echo "  tree                        Show project structure"
  echo ""
  echo -e "${BOLD}Development:${NC}"
  echo "  dev [target]                Start dev servers"
  echo "                              Targets: all (default) | backend | admin | mobile"
  echo "  build [target]              Build packages/apps"
  echo "                              Targets: all (default) | types | validation | ui-tokens"
  echo "                                       domain | api | backend | admin | packages"
  echo "  typecheck [target]          Run TypeScript type checking"
  echo "                              Targets: all (default) | types | validation | ..."
  echo "  lint                        Run ESLint across all packages"
  echo "  clean                       Remove dist/ and build artifacts"
  echo "  clean:all                   Remove dist/ AND node_modules/"
  echo ""
  echo -e "${BOLD}Database:${NC}"
  echo "  db:migrate                  Apply SQL migrations to Supabase"
  echo "  db:seed                     Run seed.sql"
  echo "  db:reset                    Migrate + seed"
  echo ""
  echo -e "${BOLD}Docker:${NC}"
  echo "  docker:build [services...]  Build Docker images"
  echo "  docker:up [services...]     Start services (backend, admin, redis)"
  echo "  docker:down [services...]   Stop services"
  echo "  docker:logs [services...]   Tail service logs"
  echo ""
  echo -e "${BOLD}Quick Start:${NC}"
  echo "  1. ./strawboss.sh install"
  echo "  2. cp .env.example .env     (edit with your Supabase credentials)"
  echo "  3. ./strawboss.sh build"
  echo "  4. ./strawboss.sh dev"
  echo ""
  echo -e "${BOLD}Production:${NC}"
  echo "  1. ./strawboss.sh docker:build"
  echo "  2. ./strawboss.sh docker:up"
  echo ""
}

# ---------------------------------------------------------------------------
# Command router
# ---------------------------------------------------------------------------
COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
  install)        cmd_install "$@" ;;
  build)          cmd_build "$@" ;;
  dev)            cmd_dev "$@" ;;
  typecheck)      cmd_typecheck "$@" ;;
  lint)           cmd_lint "$@" ;;
  clean)          cmd_clean "$@" ;;
  clean:all)      cmd_clean_all "$@" ;;
  docker:build)   cmd_docker_build "$@" ;;
  docker:up)      cmd_docker_up "$@" ;;
  docker:down)    cmd_docker_down "$@" ;;
  docker:logs)    cmd_docker_logs "$@" ;;
  db:migrate)     cmd_db_migrate "$@" ;;
  db:seed)        cmd_db_seed "$@" ;;
  db:reset)       cmd_db_reset "$@" ;;
  status)         cmd_status "$@" ;;
  tree)           cmd_tree "$@" ;;
  help|--help|-h) cmd_help "$@" ;;
  *)
    error "Unknown command: $COMMAND"
    echo "Run './strawboss.sh help' for usage."
    exit 1
    ;;
esac

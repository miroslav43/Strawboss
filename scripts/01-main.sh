#!/usr/bin/env bash
# ============================================================================
# main.sh — Primary lifecycle commands
# ============================================================================

# @section "Main"

# @cmd setup "First-time install: deps + .env + DB + packages"
cmd_setup() {
  header "StrawBoss Setup"
  require_cmd pnpm

  _ensure_env

  info "Installing dependencies..."
  pnpm install
  success "Dependencies installed."

  _build_packages

  if [ -f "$STRAWBOSS_ROOT/.env" ]; then
    # shellcheck disable=SC1091
    source "$STRAWBOSS_ROOT/.env"
    if [ -n "${DATABASE_URL:-}" ]; then
      info "Applying database migrations..."
      for migration in "$STRAWBOSS_ROOT"/supabase/migrations/*.sql; do
        local filename
        filename="$(basename "$migration")"
        printf "    %-45s" "$filename"
        local output
        if output=$(psql "$DATABASE_URL" --single-transaction -f "$migration" 2>&1); then
          echo -e "${GREEN}ok${NC}"
        elif echo "$output" | grep -qi "already exists\|duplicate"; then
          echo -e "${YELLOW}skip${NC}"
        else
          echo -e "${RED}FAIL${NC}"
          echo "      $output" | head -3
        fi
      done
      success "Migrations applied."
    else
      warn "DATABASE_URL not set — skipping migrations."
    fi
  fi

  echo ""
  success "Setup complete. Run ${BOLD}./strawboss.sh dev${NC} to start."
}

# @cmd dev "Start local dev servers (admin :3000, backend :3001, Redis)"
cmd_dev() {
  header "Starting Dev"
  require_cmd pnpm

  _free_dev_ports
  _ensure_dev_redis
  _build_packages

  echo ""
  echo -e "  ${CYAN}┌────────────────────────────────────────┐${NC}"
  echo -e "  ${CYAN}│${NC}  ${BOLD}Admin${NC}     http://localhost:3000   ${CYAN}│${NC}"
  echo -e "  ${CYAN}│${NC}  ${BOLD}Backend${NC}   http://localhost:3001   ${CYAN}│${NC}"
  echo -e "  ${CYAN}│${NC}  ${BOLD}Redis${NC}     localhost:6379          ${CYAN}│${NC}"
  echo -e "  ${CYAN}└────────────────────────────────────────┘${NC}"
  echo ""

  pnpm --filter @strawboss/backend --filter @strawboss/admin-web dev
}

# @cmd prod "Build Docker images + start production"
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

  if ! _certs_exist; then
    warn "No Let's Encrypt cert found — running ssl:init..."
    _ssl_init
  else
    info "SSL certificate already present."
  fi

  echo ""
  success "Production is live at ${BOLD}https://nortiauno.com${NC}"
}

# @cmd stop "Stop all dev processes and Docker services"
cmd_stop() {
  header "Stopping StrawBoss"

  info "Killing dev server processes..."
  _free_dev_ports
  success "Dev processes stopped."

  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    info "Stopping Docker services..."
    docker compose down 2>/dev/null
    success "Docker services stopped."
  fi
}

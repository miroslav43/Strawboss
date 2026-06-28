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

  _ensure_docker_volume_perms

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

# @cmd prod "Build + rolling-deploy production (Swarm app tier + shared nginx)"
cmd_prod() {
  header "Starting Production (Docker Swarm)"
  require_cmd docker

  # Health-gated rolling deploy of the app tier (backend ×2, admin, redis).
  # cmd_stack__deploy handles: load/validate env, ensure swarm + overlay + nginx
  # attachment, volume perms, build tagged images, and `docker stack deploy`.
  cmd_stack__deploy

  # Only (re)create the shared edge if it's NOT already running. Recreating a live
  # nginx briefly blips EVERY domain on this VM, and a normal deploy must never do
  # that — _ensure_swarm already re-attached the running nginx to the overlay.
  if ! docker ps --format '{{.Names}}' | grep -q '^strawboss-nginx-1$'; then
    info "Shared nginx not running — bringing up nginx + certbot..."
    docker compose -f "$STRAWBOSS_ROOT/docker-compose.yml" up -d nginx certbot
  else
    info "Shared nginx already running — left untouched."
  fi

  if ! _certs_exist; then
    warn "No Let's Encrypt cert found — running ssl:init..."
    _ssl_init
  else
    info "SSL certificate already present."
  fi

  echo ""
  success "Production is live at ${BOLD}https://nortiauno.com${NC}"
  info "Verify rollout: ${BOLD}./strawboss.sh stack:status${NC}"
}

# @cmd stop "Stop dev processes + the production app-tier Swarm stack"
cmd_stop() {
  header "Stopping StrawBoss"

  info "Killing dev server processes..."
  _free_dev_ports
  success "Dev processes stopped."

  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    # Remove the production app tier (Swarm). The shared nginx + certbot and the
    # OTHER apps on this VM are deliberately left running — do not `compose down`
    # nginx here, it serves every domain on the box. To take the edge down too,
    # run `docker compose down` explicitly (affects all sites).
    if docker stack ls --format '{{.Name}}' 2>/dev/null | grep -q '^strawboss-app$'; then
      info "Removing Swarm app-tier stack (shared nginx/certbot stay up)..."
      docker stack rm strawboss-app 2>/dev/null || true
      success "Production app tier stopped."
    fi
  fi
}

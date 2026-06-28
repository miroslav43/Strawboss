#!/usr/bin/env bash
# ============================================================================
# docker.sh — Docker and SSL commands
# ============================================================================

# @section "Docker"

_ssl_init() {
  info "Starting nginx for ACME HTTP-01 challenge..."
  docker compose up -d nginx
  sleep 2

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
  docker compose run --rm --entrypoint="" certbot \
    test -f /etc/letsencrypt/renewal/nortiauno.com.conf 2>/dev/null
}

# @cmd docker:build "Build Docker images"
cmd_docker__build() {
  header "Building Docker images"
  require_cmd docker
  _load_env
  docker compose build "$@"
  success "Docker images built."
}

# @cmd docker:up "Start Docker services [svc...]"
cmd_docker__up() {
  header "Starting Docker services"
  require_cmd docker
  _ensure_env
  _ensure_docker_volume_perms
  docker compose up -d "$@"
  success "Docker services started."
}

# @cmd docker:fix-volume-perms "Fix logs/ + uploads/ ownership for Docker (appuser UID 100)"
cmd_docker__fix__volume__perms() {
  header "Docker volume permissions"
  _ensure_docker_volume_perms
  success "logs/ and uploads/ are owned by UID ${DOCKER_APP_UID} (container appuser)."
  if id "${STRAWBOSS_DEV_USER:-miro}" &>/dev/null && command -v setfacl &>/dev/null; then
    info "ACL grants ${STRAWBOSS_DEV_USER:-miro} read/write on new files under logs/ and uploads/."
  fi
  if docker compose ps --status running backend 2>/dev/null | grep -q backend; then
    info "Restarting backend to pick up log file handles..."
    docker compose restart backend
  fi
}

# @cmd docker:down "Stop Docker services [svc...]"
cmd_docker__down() {
  header "Stopping Docker services"
  require_cmd docker
  docker compose down "$@"
  success "Docker services stopped."
}

# @cmd docker:logs "Tail Docker service logs [svc...]"
cmd_docker__logs() {
  require_cmd docker
  docker compose logs -f "$@"
}

# @cmd ssl:init "Issue Let's Encrypt cert for nortiauno.com"
cmd_ssl__init() {
  header "Issuing Let's Encrypt certificate"
  require_cmd docker
  _load_env
  _ssl_init
}

# ============================================================================
# Swarm — production app tier (backend ×2, admin ×1, redis ×1).
# The shared nginx + certbot stay on Compose (docker-compose.yml); only this
# app tier runs as a Swarm stack so deploys are health-gated rolling updates
# with zero downtime. See docker-stack.yml.
# ============================================================================

# @section "Swarm"

STRAWBOSS_STACK="strawboss-app"
STRAWBOSS_OVERLAY="strawboss-net"

# Ensure this node is a Swarm manager, the attachable overlay exists, and the
# (Compose) nginx is attached to it so it can reach the Swarm service VIPs.
# Idempotent — safe to run on every deploy.
_ensure_swarm() {
  if [ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)" != "active" ]; then
    info "Initializing Docker Swarm (single-node)..."
    docker swarm init --advertise-addr 127.0.0.1 >/dev/null
    success "Swarm initialized."
  fi
  if ! docker network inspect "$STRAWBOSS_OVERLAY" >/dev/null 2>&1; then
    info "Creating attachable overlay '$STRAWBOSS_OVERLAY'..."
    docker network create --driver overlay --attachable "$STRAWBOSS_OVERLAY" >/dev/null
    success "Overlay '$STRAWBOSS_OVERLAY' created."
  fi
  if docker ps --format '{{.Names}}' | grep -q '^strawboss-nginx-1$' \
     && ! docker inspect strawboss-nginx-1 \
          --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
          | grep -q "$STRAWBOSS_OVERLAY"; then
    info "Attaching nginx to '$STRAWBOSS_OVERLAY'..."
    docker network connect "$STRAWBOSS_OVERLAY" strawboss-nginx-1 || true
  fi
}

# Build the two app-tier images, tagged with the current git short-sha + :latest.
# The Dockerfiles are self-contained (they install + build the workspace inside),
# so no host pnpm build is needed. Sets STRAWBOSS_IMAGE_TAG.
_build_prod_images() {
  local tag
  tag="$(git -C "$STRAWBOSS_ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)"
  header "Building app-tier images (tag: $tag)"
  docker build -f "$STRAWBOSS_ROOT/Dockerfile.backend" \
    -t "strawboss-backend:$tag" -t "strawboss-backend:latest" "$STRAWBOSS_ROOT"
  docker build -f "$STRAWBOSS_ROOT/Dockerfile.admin" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://nortiauno.com}" \
    -t "strawboss-admin:$tag" -t "strawboss-admin:latest" "$STRAWBOSS_ROOT"
  success "Images built: strawboss-backend:$tag, strawboss-admin:$tag"
  STRAWBOSS_IMAGE_TAG="$tag"
}

# @cmd stack:deploy "Build + rolling-deploy the app-tier Swarm stack"
cmd_stack__deploy() {
  header "Deploying Swarm stack '$STRAWBOSS_STACK'"
  require_cmd docker
  _load_env
  _validate_prod_env
  _ensure_swarm
  _ensure_docker_volume_perms
  _build_prod_images
  info "Rolling update (start-first, health-gated, auto-rollback)..."
  # _load_env exported the .env vars; docker stack deploy interpolates them.
  IMAGE_TAG="$STRAWBOSS_IMAGE_TAG" docker stack deploy \
    -c "$STRAWBOSS_ROOT/docker-stack.yml" --resolve-image never "$STRAWBOSS_STACK"
  docker image prune -f >/dev/null 2>&1 || true
  success "Deployed. Watch convergence: ./strawboss.sh stack:status"
}

# @cmd stack:status "Show app-tier Swarm services + tasks"
cmd_stack__status() {
  require_cmd docker
  docker stack services "$STRAWBOSS_STACK"
  echo ""
  docker stack ps "$STRAWBOSS_STACK" --no-trunc \
    --format 'table {{.Name}}\t{{.CurrentState}}\t{{.Error}}' 2>/dev/null | head -20
}

# @cmd stack:logs "Tail an app-tier service log [strawboss-backend|strawboss-admin|redis]"
cmd_stack__logs() {
  require_cmd docker
  local svc="${1:-strawboss-backend}"
  docker service logs -f "${STRAWBOSS_STACK}_${svc}"
}

# @cmd stack:rollback "Roll a service back to its previous image [backend|admin]"
cmd_stack__rollback() {
  require_cmd docker
  local svc="strawboss-${1:-backend}"
  header "Rolling back ${STRAWBOSS_STACK}_${svc}"
  docker service rollback "${STRAWBOSS_STACK}_${svc}"
}

# @cmd scale "Scale a service: ./strawboss.sh scale backend 3"
cmd_scale() {
  require_cmd docker
  local svc="${1:?usage: scale <backend|admin> <n>}"
  local n="${2:?usage: scale <backend|admin> <n>}"
  docker service scale "${STRAWBOSS_STACK}_strawboss-${svc}=${n}"
}

# @cmd stack:rm "Remove the app-tier Swarm stack (nginx/certbot stay up)"
cmd_stack__rm() {
  require_cmd docker
  header "Removing Swarm stack '$STRAWBOSS_STACK'"
  docker stack rm "$STRAWBOSS_STACK"
}

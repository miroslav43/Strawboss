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
  docker compose up -d "$@"
  success "Docker services started."
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

#!/bin/sh
# nginx startup script.
# If Let's Encrypt certs don't exist yet, generate a temporary self-signed
# cert so nginx can start (required to serve the ACME challenge on port 80).
# Run ./strawboss.sh ssl:init to replace it with a real cert, then reload:
#   docker compose exec nginx nginx -s reload

set -e

CERT_DIR=/etc/letsencrypt/live/nortiauno.com

if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "[entrypoint] No cert found — generating self-signed placeholder for $CERT_DIR"
  # nginx:alpine does not include the openssl CLI — install it if missing.
  if ! command -v openssl > /dev/null 2>&1; then
    echo "[entrypoint] Installing openssl..."
    apk add --no-cache openssl
  fi
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout  "$CERT_DIR/privkey.pem" \
    -out     "$CERT_DIR/fullchain.pem" \
    -days 1 \
    -subj "/CN=nortiauno.com"
  echo "[entrypoint] Self-signed cert created. Run './strawboss.sh ssl:init' to get a real cert."
fi

exec nginx -g "daemon off;"

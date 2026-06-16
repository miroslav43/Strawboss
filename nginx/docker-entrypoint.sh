#!/bin/sh
# nginx startup script.
# If Let's Encrypt certs don't exist yet, generate a temporary self-signed
# cert so nginx can start (required to serve the ACME challenge on port 80).
# Run ./strawboss.sh ssl:init or the site's deploy.sh to replace with a real cert, then reload:
#   docker compose exec nginx nginx -s reload

set -e

# All domains that need an SSL block in nginx conf (need self-signed placeholder at startup)
DOMAINS="nortiauno.com licenta.scoala-ai.ro"

for DOMAIN in $DOMAINS; do
  CERT_DIR=/etc/letsencrypt/live/$DOMAIN
  if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
    echo "[entrypoint] No cert found — generating self-signed placeholder for $DOMAIN"
    if ! command -v openssl > /dev/null 2>&1; then
      echo "[entrypoint] Installing openssl..."
      apk add --no-cache openssl
    fi
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout  "$CERT_DIR/privkey.pem" \
      -out     "$CERT_DIR/fullchain.pem" \
      -days 1 \
      -subj "/CN=$DOMAIN"
    echo "[entrypoint] Self-signed cert created for $DOMAIN. Run deploy.sh to get a real cert."
  fi
done

exec nginx -g "daemon off;"

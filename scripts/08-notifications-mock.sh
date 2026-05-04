#!/usr/bin/env bash
# ============================================================================
# Mock / debug mobile push: lookup users + device tokens, send admin broadcast
# (matches POST /api/v1/notifications/broadcast; push delivery requires Expo
# token(s) in device_push_tokens).
# ============================================================================

# @section "Notifications"

# @cmd notif-lookup "List user id, email, role and device_push_tokens (optional SQL ILIKE pattern, default %dmaletici%)"
cmd_notif__lookup() {
  _load_env
  require_cmd psql
  local pattern="${1:-"%dmaletici%"}"
  header "User match (email ILIKE or username ILIKE $pattern)"
  psql "$DATABASE_URL" -c "\
    SELECT id, email, COALESCE(username, '') AS username, role
    FROM users
    WHERE deleted_at IS NULL
      AND (email ILIKE '$pattern' OR username ILIKE '$pattern')
    ORDER BY email;
  "

  local uid
  uid=$(psql "$DATABASE_URL" -t -A -c "\
    SELECT id FROM users
    WHERE deleted_at IS NULL
      AND (email ILIKE '$pattern' OR username ILIKE '$pattern')
    LIMIT 1;
  " | tr -d '[:space:]')

  if [ -z "$uid" ] || [ "$uid" = "" ]; then
    warn "No user matched."
    return 1
  fi

  header "device_push_tokens for $uid"
  psql "$DATABASE_URL" -c "\
    SELECT id, user_id, platform, is_active,
           left(token, 36) || '...' AS token_prefix,
           to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated
    FROM device_push_tokens
    WHERE user_id = '$uid'::uuid
    ORDER BY updated_at DESC;
  "

  local n
  n=$(psql "$DATABASE_URL" -t -A -c "\
    SELECT count(*)::text FROM device_push_tokens
    WHERE user_id = '$uid'::uuid AND is_active = true;
  " | tr -d '[:space:]')
  if [ "${n:-0}" = "0" ]; then
    warn "No active push token — open the mobile app (logged in) so it POSTs /api/v1/notifications/register-token, then re-run notif-lookup."
  else
    success "Active device token(s): $n"
  fi
}

# @cmd notif-broadcast "POST a test broadcast (admin HS256). Args: [email-pattern] [api-base URL, default from NEXT_PUBLIC_API_URL]"
cmd_notif__broadcast() {
  _load_env
  require_cmd psql
  require_cmd node
  require_cmd curl

  local pattern="${1:-"%dmaletici%"}"
  local api_base="${2:-${NEXT_PUBLIC_API_URL:-http://127.0.0.1:3001}}"
  api_base="${api_base%/}"

  local target_uid
  target_uid=$(psql "$DATABASE_URL" -t -A -c "\
    SELECT id FROM users
    WHERE deleted_at IS NULL
      AND (email ILIKE '$pattern' OR username ILIKE '$pattern')
    LIMIT 1;
  " | tr -d '[:space:]')

  if [ -z "$target_uid" ]; then
    error "No user for pattern: $pattern"
    exit 1
  fi

  local admin_id
  admin_id=$(psql "$DATABASE_URL" -t -A -c "\
    SELECT id FROM users
    WHERE role = 'admin' AND deleted_at IS NULL
    LIMIT 1;
  " | tr -d '[:space:]')
  if [ -z "$admin_id" ]; then
    error "No admin user in database — cannot sign broadcast."
    exit 1
  fi

  export ADMIN_ID="$admin_id"
  local jwt
  jwt=$(
    cd "$STRAWBOSS_ROOT/backend/service" && node -e "
      const jose = require('jose');
      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      const sub = process.env.ADMIN_ID;
      (async () => {
        const jwt = await new jose.SignJWT({
          app_metadata: { role: 'admin' },
        })
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject(sub)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(secret);
        process.stdout.write(jwt);
      })();
    "
  ) || true
  if [ -z "$jwt" ]; then
    error "Failed to sign JWT. Run from monorepo root with SUPABASE_JWT_SECRET in .env."
    exit 1
  fi

  header "Broadcast → user $target_uid"
  info "API: $api_base/api/v1/notifications/broadcast"

  local out http
  out=$(curl -sS -w "\n%{http_code}" -X POST "$api_base/api/v1/notifications/broadcast" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $jwt" \
    -d "{\"target\":{\"kind\":\"user\",\"userId\":\"$target_uid\"},\"title\":\"Test Strawboss\",\"body\":\"Mock broadcast (./strawboss.sh notif-broadcast).\"}" 2>&1) || true
  http=$(echo "$out" | tail -n1)
  out=$(echo "$out" | sed '$d')
  echo "$out"
  if [ "$http" = "201" ] || [ "$http" = "200" ]; then
    success "HTTP $http — backend accepted (Expo will only deliver if device_push_tokens has an active token for that user)."
  else
    warn "HTTP $http (expected 200/201 for success)"
  fi

  echo ""
  info "Optional — push directly to Expo (bypasses backend), full token from logs or notif-lookup (remove ...):"
  echo "  curl -sS -X POST 'https://exp.host/--/api/v2/push/send' -H 'Content-Type: application/json' \\"
  echo "    -d '[{\"to\":\"ExponentPushToken[...]\",\"title\":\"Expo only\",\"body\":\"...\",\"data\":{\"type\":\"broadcast\"}}]'"
}

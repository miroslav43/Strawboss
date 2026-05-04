#!/usr/bin/env bash
# ============================================================================
# 08-mock.sh — Mock notification & end-to-end trip scripts
#
# Quick smoke-test commands that hit the dev backend on
# ${API_URL:-http://localhost:3001} so you can see push notifications light
# up the mobile bell + OS badge without driving GPS / loaders by hand.
#
# Two flavours:
#   1. mock:* — fast simulator pushes via /api/v1/dev/notifications/simulate
#      (skips workflow, just delivers the push payload to a single user).
#   2. mock:e2e-trip — drives a real planned trip through start-loading →
#      register-load → depart → arrive, exercising the production push paths
#      from `trips.service.ts`.
#
# Auth: every call mints a short-lived HS256 JWT signed with the project's
# SUPABASE_JWT_SECRET (see _lib.sh::mock_jwt). The seed user IDs are the
# constants SEED_*_ID also in _lib.sh and supabase/seed.sql.
# ============================================================================

# @section "Mock / Test"

_mock_simulate() {
  # _mock_simulate <event> <target_user_alias> <vars_json>
  local event="${1:-}"
  local user_alias="${2:-driver}"
  local vars_json="${3:-{\}}"

  if [ -z "$event" ]; then
    error "_mock_simulate: event required"
    return 1
  fi

  _load_env
  local user_id token target_user_id
  user_id="$(mock_user_id_for "$user_alias")" || return 1
  target_user_id="$user_id"
  # Always sign as admin — only admin can hit /dev/notifications/simulate.
  token="$(mock_jwt "$SEED_ADMIN_ID" admin)"

  local body
  body=$(printf '{"event":"%s","target":{"userId":"%s"},"vars":%s}' \
    "$event" "$target_user_id" "$vars_json")

  info "POST /api/v1/dev/notifications/simulate  ${DIM}(event=$event, user=$user_alias)${NC}"
  api_post /api/v1/dev/notifications/simulate "$token" "$body"
  echo ""
}

# @cmd mock:field-arrival "Push: truck arrived at field (target driver|loader)"
cmd_mock__field__arrival() {
  local user="${1:-driver}"
  if [ "${1:-}" = "--user" ]; then user="${2:-driver}"; fi
  _mock_simulate field_entry "$user" '{"parcel":"C\u00e2mpul Demo"}'
}

# @cmd mock:loader-arrival "Push: a truck has arrived at the loader (target loader)"
cmd_mock__loader__arrival() {
  _mock_simulate truck_arrived_at_loader loader \
    '{"plate":"OS-1234-AB","parcel":"C\u00e2mpul Demo"}'
}

# @cmd mock:warehouse-arrival "Push: truck entered warehouse/deposit (target driver)"
cmd_mock__warehouse__arrival() {
  _mock_simulate deposit_entry driver '{}'
}

# @cmd mock:trip-loaded "Push: truck is full / ready to depart (target driver)"
cmd_mock__trip__loaded() {
  _mock_simulate trip_loaded driver '{"plate":"OS-1234-AB"}'
}

# @cmd mock:trip-departed "Push: trip departed for destination (target driver)"
cmd_mock__trip__departed() {
  _mock_simulate trip_departed driver '{"warehouse":"Farma Slavonija"}'
}

# @cmd mock:broadcast "Push: admin broadcast (--title \"...\" --body \"...\")"
cmd_mock__broadcast() {
  local title="Anun\u021b dispecerat"
  local body="Mesaj de test din scripts/08-mock.sh"
  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --body)  body="$2";  shift 2 ;;
      *) shift ;;
    esac
  done

  _load_env
  local token
  token="$(mock_jwt "$SEED_ADMIN_ID" admin)"
  local payload
  payload=$(printf '{"target":{"kind":"all"},"title":%s,"body":%s}' \
    "$(printf '"%s"' "$title")" \
    "$(printf '"%s"' "$body")")

  info "POST /api/v1/notifications/broadcast"
  api_post /api/v1/notifications/broadcast "$token" "$payload"
  echo ""
}

# @cmd mock:e2e-trip "End-to-end: create + start-loading + register-load + depart + arrive"
cmd_mock__e2e__trip() {
  _load_env
  require_cmd jq

  local admin_token driver_token loader_token
  admin_token="$(mock_jwt "$SEED_ADMIN_ID" admin)"
  driver_token="$(mock_jwt "$SEED_DRIVER_ID" driver)"
  loader_token="$(mock_jwt "$SEED_LOADER_ID" loader_operator)"

  header "Mock E2E Trip Flow"

  # 1) Create the trip (admin)
  info "[1/5] POST /trips  — create planned trip"
  local create_body
  create_body=$(printf '{"sourceParcelId":"%s","truckId":"%s","driverId":"%s","loaderId":"%s","loaderOperatorId":"%s","destinationName":"Farma Slavonija d.o.o."}' \
    "$SEED_PARCEL_ID" "$SEED_TRUCK_ID" "$SEED_DRIVER_ID" "$SEED_LOADER_MACHINE_ID" "$SEED_LOADER_ID")
  local create_response trip_id
  create_response=$(api_post /api/v1/trips "$admin_token" "$create_body") || {
    error "Trip creation failed — bail out."
    return 1
  }
  trip_id=$(echo "$create_response" | jq -r '.[0].id // .id // empty')
  if [ -z "$trip_id" ] || [ "$trip_id" = "null" ]; then
    error "Could not extract trip id from create response:"
    echo "$create_response"
    return 1
  fi
  success "Trip created: $trip_id"
  sleep 0.5

  # 2) Start loading (admin) — pushes 'assignment_created' to driver
  info "[2/5] POST /trips/$trip_id/start-loading"
  local sl_body
  sl_body=$(printf '{"loaderOperatorId":"%s","loaderId":"%s"}' \
    "$SEED_LOADER_ID" "$SEED_LOADER_MACHINE_ID")
  api_post "/api/v1/trips/$trip_id/start-loading" "$admin_token" "$sl_body" >/dev/null
  success "Loading started → driver should see 'Începe încărcarea'"
  sleep 1

  # 3) Register load (loader) — pushes 'trip_loaded' to driver
  info "[3/5] POST /trips/register-load  — loader registers bales"
  local idem_key
  idem_key=$(node -e 'console.log(crypto.randomUUID())')
  local rl_body
  rl_body=$(printf '{"truckId":"%s","loaderMachineId":"%s","parcelId":"%s","baleCount":12,"idempotencyKey":"%s"}' \
    "$SEED_TRUCK_ID" "$SEED_LOADER_MACHINE_ID" "$SEED_PARCEL_ID" "$idem_key")
  api_post "/api/v1/trips/register-load" "$loader_token" "$rl_body" >/dev/null
  success "12 bales registered → driver should see 'Transport pregătit'"
  sleep 1

  # 4) Depart (driver) — pushes 'trip_departed' to driver
  info "[4/5] POST /trips/$trip_id/depart"
  api_post "/api/v1/trips/$trip_id/depart" "$driver_token" '{"departureOdometerKm":125000}' >/dev/null
  success "Departed → driver should see 'Drum bun'"
  sleep 1

  # 5) Arrive (driver) — pushes 'trip_arrived' to driver
  info "[5/5] POST /trips/$trip_id/arrive"
  api_post "/api/v1/trips/$trip_id/arrive" "$driver_token" '{"arrivalOdometerKm":125042}' >/dev/null
  success "Arrived → driver should see 'Ai ajuns la destinație'"

  echo ""
  success "E2E flow complete. Trip $trip_id is now in 'arrived' status."
  info "Tip: open the mobile app as driver to see all 4 push notifications."
}

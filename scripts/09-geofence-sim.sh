#!/usr/bin/env bash
# ============================================================================
# Simulation — GPS, geofence events, push notifications
# For testing the mobile notification flow without a physical device moving.
# Requires: psql, node, curl + SUPABASE_JWT_SECRET / DATABASE_URL in .env
# Backend must be running for push delivery (./strawboss.sh dev).
# ============================================================================

# @section "Simulation"

# ---------------------------------------------------------------------------
# Private helpers (_sim_* prefix)
# ---------------------------------------------------------------------------

_sim_sanitize() {
  # Strip characters that could break SQL in ILIKE patterns
  printf '%s' "$1" | tr -d "';/*\`\\" | sed 's/--//g'
}

# Resolve <machine-or-email> to globals:
#   SIM_MACHINE_ID  SIM_MACHINE_TYPE  SIM_MACHINE_CODE
#   SIM_OPERATOR_ID  SIM_OPERATOR_ROLE  SIM_OPERATOR_EMAIL
# Args: <target> [date=today]
_sim_resolve_target() {
  local raw="$1"
  local dt="${2:-$(date +%Y-%m-%d)}"
  local target
  target=$(_sim_sanitize "$raw")

  SIM_MACHINE_ID="" SIM_MACHINE_TYPE="" SIM_MACHINE_CODE=""
  SIM_OPERATOR_ID="" SIM_OPERATOR_ROLE="" SIM_OPERATOR_EMAIL=""

  if [[ "$target" == *"@"* ]] || [[ "$target" == *"%"* ]]; then
    # ---- resolve by user email / username pattern ----
    SIM_OPERATOR_ID=$(psql "$DATABASE_URL" -t -A -c "
      SELECT id FROM users
      WHERE deleted_at IS NULL
        AND (email ILIKE '$target' OR username ILIKE '$target')
      LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true

    if [ -z "$SIM_OPERATOR_ID" ]; then
      error "No user matched pattern: $raw"; return 1
    fi

    local urow
    urow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT role, COALESCE(email,'') FROM users
      WHERE id='$SIM_OPERATOR_ID'::uuid LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true
    SIM_OPERATOR_ROLE="${urow%%|*}"
    SIM_OPERATOR_EMAIL="${urow##*|}"

    SIM_MACHINE_ID=$(psql "$DATABASE_URL" -t -A -c "
      SELECT machine_id FROM task_assignments
      WHERE assigned_user_id='$SIM_OPERATOR_ID'::uuid
        AND assignment_date='$dt'
        AND deleted_at IS NULL
      LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true

    if [ -z "$SIM_MACHINE_ID" ]; then
      SIM_MACHINE_ID=$(psql "$DATABASE_URL" -t -A -c "
        SELECT assigned_machine_id FROM users
        WHERE id='$SIM_OPERATOR_ID'::uuid
          AND assigned_machine_id IS NOT NULL
        LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true
    fi

    if [ -z "$SIM_MACHINE_ID" ]; then
      error "User '$SIM_OPERATOR_EMAIL' has no machine assignment on $dt"; return 1
    fi

  elif [[ "$target" =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]]; then
    # ---- resolve by machine UUID ----
    SIM_MACHINE_ID="$target"

    local oprow
    oprow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT u.id, u.role, COALESCE(u.email,'')
      FROM task_assignments ta
      JOIN users u ON u.id = ta.assigned_user_id
      WHERE ta.machine_id='$target'::uuid
        AND ta.assignment_date='$dt'
        AND ta.deleted_at IS NULL
        AND ta.assigned_user_id IS NOT NULL
      LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true
    if [ -n "$oprow" ]; then
      SIM_OPERATOR_ID="${oprow%%|*}"
      local rest="${oprow#*|}"
      SIM_OPERATOR_ROLE="${rest%%|*}"
      SIM_OPERATOR_EMAIL="${rest##*|}"
    fi

  else
    # ---- resolve by machine code / plate ILIKE ----
    SIM_MACHINE_ID=$(psql "$DATABASE_URL" -t -A -c "
      SELECT id FROM machines
      WHERE deleted_at IS NULL
        AND (internal_code ILIKE '$target' OR registration_plate ILIKE '$target')
      LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true

    if [ -z "$SIM_MACHINE_ID" ]; then
      error "No machine matched '$raw' (tried UUID, code, plate, email pattern)"; return 1
    fi

    local oprow
    oprow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT u.id, u.role, COALESCE(u.email,'')
      FROM task_assignments ta
      JOIN users u ON u.id = ta.assigned_user_id
      WHERE ta.machine_id='$SIM_MACHINE_ID'::uuid
        AND ta.assignment_date='$dt'
        AND ta.deleted_at IS NULL
        AND ta.assigned_user_id IS NOT NULL
      LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true
    if [ -n "$oprow" ]; then
      SIM_OPERATOR_ID="${oprow%%|*}"
      local rest="${oprow#*|}"
      SIM_OPERATOR_ROLE="${rest%%|*}"
      SIM_OPERATOR_EMAIL="${rest##*|}"
    fi
  fi

  if [ -z "$SIM_MACHINE_ID" ]; then
    error "Could not resolve machine for: $raw"; return 1
  fi

  SIM_MACHINE_TYPE=$(psql "$DATABASE_URL" -t -A -c "
    SELECT machine_type FROM machines WHERE id='$SIM_MACHINE_ID'::uuid LIMIT 1;" \
    2>/dev/null | tr -d '[:space:]') || true
  SIM_MACHINE_CODE=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COALESCE(internal_code, registration_plate) FROM machines
    WHERE id='$SIM_MACHINE_ID'::uuid LIMIT 1;" \
    2>/dev/null | tr -d '[:space:]') || true
}

# Sign JWT for any user+role  (requires jose in backend/service/node_modules)
# Usage: jwt=$(_sim_sign_jwt <user_id> <role>)
_sim_sign_jwt() {
  local uid="$1" role="$2"
  export _SIM_JWT_SUB="$uid" _SIM_JWT_ROLE="$role"
  (
    cd "$STRAWBOSS_ROOT/backend/service" && node -e "
      const jose = require('jose');
      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      (async () => {
        const jwt = await new jose.SignJWT({
            app_metadata: { role: process.env._SIM_JWT_ROLE }
          })
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject(process.env._SIM_JWT_SUB)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(secret);
        process.stdout.write(jwt);
      })();
    " 2>/dev/null
  )
}

# Sign as first admin in DB
_sim_admin_jwt() {
  local aid
  aid=$(psql "$DATABASE_URL" -t -A -c "
    SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL LIMIT 1;" \
    2>/dev/null | tr -d '[:space:]')
  if [ -z "$aid" ]; then error "No admin user in DB."; return 1; fi
  _sim_sign_jwt "$aid" "admin"
}

# Send push via POST /api/v1/notifications/broadcast (signs as admin)
# Usage: _sim_push <user_id> <title> <body> [data_json='{}']
_sim_push() {
  local uid="$1" title="$2" body_msg="$3" data="${4:-{\}}"
  local api_base="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:3001}"
  api_base="${api_base%/}"

  local jwt
  jwt=$(_sim_admin_jwt) || return 1

  local payload
  payload=$(
    _P_UID="$uid" _P_TITLE="$title" _P_BODY="$body_msg" _P_DATA="$data" \
    node -e "
      const p = {
        target: { kind: 'user', userId: process.env._P_UID },
        title: process.env._P_TITLE,
        body: process.env._P_BODY,
      };
      try { p.data = JSON.parse(process.env._P_DATA); } catch(e) {}
      process.stdout.write(JSON.stringify(p));
    " 2>/dev/null
  ) || payload="{\"target\":{\"kind\":\"user\",\"userId\":\"$uid\"},\"title\":\"$title\",\"body\":\"$body_msg\"}"

  local http out
  out=$(curl -sS -w "\n%{http_code}" -X POST "$api_base/api/v1/notifications/broadcast" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $jwt" \
    -d "$payload" 2>&1) || true
  http=$(echo "$out" | tail -n1)
  if [ "$http" = "200" ] || [ "$http" = "201" ]; then
    success "Push delivered → user $uid"
  else
    warn "Push HTTP $http (backend running? push token registered?)"
    echo "$out" | sed '$d'
  fi
}

# ---------------------------------------------------------------------------
# @cmd sim-list "List machines, assignments, parcels and depots. Arg: [YYYY-MM-DD]"
# ---------------------------------------------------------------------------
cmd_sim__list() {
  _load_env
  require_cmd psql

  local dt="${1:-$(date +%Y-%m-%d)}"

  header "Machines"
  psql "$DATABASE_URL" -c "
    SELECT
      id,
      machine_type                                         AS type,
      COALESCE(internal_code, registration_plate)          AS code,
      COALESCE((SELECT email FROM users
                WHERE assigned_machine_id=m.id
                  AND deleted_at IS NULL LIMIT 1), '—')    AS assigned_user
    FROM machines m
    WHERE deleted_at IS NULL
    ORDER BY machine_type, code;" 2>/dev/null || true

  header "Assignments for $dt"
  psql "$DATABASE_URL" -c "
    SELECT
      COALESCE(m.internal_code, m.registration_plate)   AS machine,
      m.machine_type                                     AS type,
      ta.status,
      COALESCE(u.email, '—')                             AS operator,
      COALESCE(p.name, '—')                              AS parcel,
      CASE WHEN p.boundary IS NOT NULL THEN 'y' ELSE 'n' END AS p_geo,
      COALESCE(dd.name, '—')                             AS depot,
      CASE WHEN dd.boundary IS NOT NULL THEN 'y'
           WHEN dd.coords  IS NOT NULL THEN 'pt'
           ELSE 'n' END                                  AS d_geo
    FROM task_assignments ta
    JOIN machines m ON m.id = ta.machine_id
    LEFT JOIN users u ON u.id = ta.assigned_user_id
    LEFT JOIN parcels p ON p.id = ta.parcel_id
    LEFT JOIN delivery_destinations dd ON dd.id = ta.destination_id
    WHERE ta.assignment_date = '$dt'
      AND ta.deleted_at IS NULL
    ORDER BY m.machine_type;" 2>/dev/null || true

  header "Parcels (active, with geometry) — first 15"
  psql "$DATABASE_URL" -c "
    SELECT
      id, code, COALESCE(name,'—') AS name,
      CASE WHEN boundary IS NOT NULL
        THEN round((ST_Area(boundary::geography)/10000)::numeric,2)::text || ' ha'
        ELSE 'no boundary' END     AS area,
      CASE WHEN boundary IS NOT NULL THEN
        round(ST_Y(ST_Centroid(boundary))::numeric,6)::text || ', ' ||
        round(ST_X(ST_Centroid(boundary))::numeric,6)::text
        ELSE '—' END               AS centroid_lat_lon
    FROM parcels
    WHERE deleted_at IS NULL AND is_active = true
    ORDER BY code
    LIMIT 15;" 2>/dev/null || true

  header "Depots / Delivery Destinations"
  psql "$DATABASE_URL" -c "
    SELECT
      id, code, name,
      CASE WHEN boundary IS NOT NULL THEN 'boundary'
           WHEN coords IS NOT NULL   THEN 'point'
           ELSE 'none' END           AS geometry,
      CASE WHEN boundary IS NOT NULL THEN
        round(ST_Y(ST_Centroid(boundary))::numeric,6)::text || ', ' ||
        round(ST_X(ST_Centroid(boundary))::numeric,6)::text
      WHEN coords IS NOT NULL THEN
        round(ST_Y(coords)::numeric,6)::text || ', ' ||
        round(ST_X(coords)::numeric,6)::text
      ELSE '—' END                   AS centroid_lat_lon
    FROM delivery_destinations
    WHERE deleted_at IS NULL AND is_active = true
    ORDER BY code;" 2>/dev/null || true

  header "Recent geofence events (last 20)"
  psql "$DATABASE_URL" -c "
    SELECT
      ge.event_type                                        AS event,
      ge.geofence_type                                     AS type,
      COALESCE(p.name, dd.name, left(ge.geofence_id::text,8)||'...') AS geofence,
      COALESCE(m.internal_code, m.registration_plate)     AS machine,
      to_char(ge.created_at AT TIME ZONE 'Europe/Bucharest',
              'MM-DD HH24:MI:SS')                          AS time_ro
    FROM geofence_events ge
    LEFT JOIN parcels p ON p.id = ge.geofence_id
    LEFT JOIN delivery_destinations dd ON dd.id = ge.geofence_id
    LEFT JOIN machines m ON m.id = ge.machine_id
    ORDER BY ge.created_at DESC
    LIMIT 20;" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# @cmd sim-gps "Inject a GPS ping for a machine via the API. Args: <machine-or-email> <lat> <lon>"
# ---------------------------------------------------------------------------
cmd_sim__gps() {
  _load_env
  require_cmd psql
  require_cmd node
  require_cmd curl

  local target="${1:-}" lat="${2:-}" lon="${3:-}"
  if [ -z "$target" ] || [ -z "$lat" ] || [ -z "$lon" ]; then
    error "Usage: ./strawboss.sh sim-gps <machine-or-email> <lat> <lon>"
    error "       ./strawboss.sh sim-gps '%dmaletici%' 44.1234 26.5678"
    exit 1
  fi

  _sim_resolve_target "$target" || exit 1

  info "Machine:  $SIM_MACHINE_CODE ($SIM_MACHINE_TYPE)"
  info "Operator: ${SIM_OPERATOR_EMAIL:-—}"
  info "Coords:   $lat, $lon"

  if [ -z "$SIM_OPERATOR_ID" ]; then
    warn "No operator found — inserting GPS directly into DB"
    psql "$DATABASE_URL" -c "
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, recorded_at)
      VALUES (
        '$SIM_MACHINE_ID'::uuid,
        (SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL LIMIT 1),
        $lat, $lon, 5.0, now()
      );" 2>/dev/null
    success "GPS inserted (direct DB)"
    return 0
  fi

  local jwt
  jwt=$(_sim_sign_jwt "$SIM_OPERATOR_ID" "$SIM_OPERATOR_ROLE") || {
    error "JWT signing failed"; exit 1
  }

  local api_base="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:3001}"
  api_base="${api_base%/}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  local http out
  out=$(curl -sS -w "\n%{http_code}" -X POST "$api_base/api/v1/location/report" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $jwt" \
    -d "{\"machineId\":\"$SIM_MACHINE_ID\",\"lat\":$lat,\"lon\":$lon,\"accuracyM\":5,\"recordedAt\":\"$ts\"}" \
    2>&1) || true
  http=$(echo "$out" | tail -n1)

  if [ "$http" = "204" ] || [ "$http" = "200" ]; then
    success "GPS reported via API (HTTP $http)"
  else
    warn "HTTP $http (expected 204) — falling back to direct DB insert"
    psql "$DATABASE_URL" -c "
      INSERT INTO machine_location_events
        (machine_id, operator_id, lat, lon, accuracy_m, recorded_at)
      VALUES ('$SIM_MACHINE_ID'::uuid,'$SIM_OPERATOR_ID'::uuid,$lat,$lon,5.0,now());" \
      2>/dev/null && success "GPS inserted (direct DB)"
  fi
}

# ---------------------------------------------------------------------------
# @cmd sim-enter "Simulate machine entering its assigned geofence + push. Args: <machine-or-email> [geofence-id|auto]"
# ---------------------------------------------------------------------------
cmd_sim__enter() {
  _load_env
  require_cmd psql
  require_cmd node
  require_cmd curl

  local target="${1:-}" geofence_arg="${2:-auto}"
  if [ -z "$target" ]; then
    error "Usage: ./strawboss.sh sim-enter <machine-or-email> [geofence-id|auto]"
    exit 1
  fi

  local dt
  dt=$(date +%Y-%m-%d)
  _sim_resolve_target "$target" "$dt" || exit 1

  info "Machine:  $SIM_MACHINE_CODE ($SIM_MACHINE_TYPE)"
  info "Operator: ${SIM_OPERATOR_EMAIL:-—}"

  # ---- resolve geofence ----
  local geofence_id geofence_type geofence_name assignment_id assignment_status

  if [ "$geofence_arg" = "auto" ]; then
    local arow
    arow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT ta.id, ta.status,
             COALESCE(ta.parcel_id::text,''),
             COALESCE(ta.destination_id::text,''),
             COALESCE(p.name,''),
             COALESCE(dd.name,'')
      FROM task_assignments ta
      LEFT JOIN parcels p ON p.id = ta.parcel_id
      LEFT JOIN delivery_destinations dd ON dd.id = ta.destination_id
      WHERE ta.machine_id='$SIM_MACHINE_ID'::uuid
        AND ta.assignment_date='$dt'
        AND ta.deleted_at IS NULL
      LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true

    if [ -z "$arow" ]; then
      error "No assignment for machine $SIM_MACHINE_CODE on $dt — use sim-list"
      exit 1
    fi

    IFS='|' read -r assignment_id assignment_status \
      parcel_raw dest_raw parcel_name dest_name <<< "$arow"
    parcel_raw=$(echo "$parcel_raw" | tr -d '[:space:]')
    dest_raw=$(echo "$dest_raw"    | tr -d '[:space:]')

    if [ -n "$parcel_raw" ]; then
      geofence_id="$parcel_raw"; geofence_type="parcel"; geofence_name="$parcel_name"
    elif [ -n "$dest_raw" ]; then
      geofence_id="$dest_raw"; geofence_type="deposit"; geofence_name="$dest_name"
    else
      error "Assignment has no parcel or deposit geofence"; exit 1
    fi
  else
    local gid
    gid=$(_sim_sanitize "$geofence_arg")

    local pname dname
    pname=$(psql "$DATABASE_URL" -t -A -c "
      SELECT COALESCE(name,'') FROM parcels
      WHERE id='$gid'::uuid AND deleted_at IS NULL LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true
    dname=$(psql "$DATABASE_URL" -t -A -c "
      SELECT name FROM delivery_destinations
      WHERE id='$gid'::uuid AND deleted_at IS NULL LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true

    if [ -n "$pname" ]; then
      geofence_id="$gid"; geofence_type="parcel"; geofence_name="$pname"
    elif [ -n "$dname" ]; then
      geofence_id="$gid"; geofence_type="deposit"; geofence_name="$dname"
    else
      error "Geofence ID not found: $geofence_arg"; exit 1
    fi

    local col
    col=$([ "$geofence_type" = "parcel" ] && echo "parcel_id" || echo "destination_id")
    assignment_id=$(psql "$DATABASE_URL" -t -A -c "
      SELECT id FROM task_assignments
      WHERE machine_id='$SIM_MACHINE_ID'::uuid
        AND ${col}='$geofence_id'::uuid
        AND assignment_date='$dt'
        AND deleted_at IS NULL
      LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true
    assignment_status=$(psql "$DATABASE_URL" -t -A -c "
      SELECT status FROM task_assignments WHERE id='$assignment_id'::uuid LIMIT 1;" \
      2>/dev/null | tr -d '[:space:]') || true
  fi

  assignment_id=$(echo "$assignment_id" | tr -d '[:space:]')
  info "Geofence: $geofence_name ($geofence_type)"

  # ---- get centroid ----
  local crow centroid_lat centroid_lon
  if [ "$geofence_type" = "parcel" ]; then
    crow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT round(ST_Y(ST_Centroid(boundary))::numeric,6),
             round(ST_X(ST_Centroid(boundary))::numeric,6)
      FROM parcels WHERE id='$geofence_id'::uuid AND boundary IS NOT NULL LIMIT 1;" \
      2>/dev/null | head -1 | tr -d '\r') || true
  else
    crow=$(psql "$DATABASE_URL" -t -A -c "
      SELECT round(COALESCE(ST_Y(ST_Centroid(boundary)),ST_Y(coords))::numeric,6),
             round(COALESCE(ST_X(ST_Centroid(boundary)),ST_X(coords))::numeric,6)
      FROM delivery_destinations WHERE id='$geofence_id'::uuid LIMIT 1;" \
      2>/dev/null | head -1 | tr -d '\r') || true
  fi

  centroid_lat=$(echo "${crow%%|*}" | tr -d '[:space:]')
  centroid_lon=$(echo "${crow##*|}" | tr -d '[:space:]')

  if [ -z "$centroid_lat" ] || [ "$centroid_lat" = "$centroid_lon" ]; then
    error "No geometry for geofence $geofence_id"
    error "Draw a boundary polygon in the admin dashboard first"
    exit 1
  fi

  info "Centroid: $centroid_lat, $centroid_lon"

  # 1. Insert GPS at centroid
  local op_expr
  op_expr=$([ -n "$SIM_OPERATOR_ID" ] && echo "'$SIM_OPERATOR_ID'::uuid" \
    || echo "(SELECT id FROM users WHERE role='admin' LIMIT 1)")
  psql "$DATABASE_URL" -c "
    INSERT INTO machine_location_events
      (machine_id, operator_id, lat, lon, accuracy_m, recorded_at)
    VALUES ('$SIM_MACHINE_ID'::uuid, $op_expr, $centroid_lat, $centroid_lon, 5.0, now());" \
    2>/dev/null
  success "GPS at centroid inserted"

  # 2. Insert geofence ENTER event
  local assign_expr
  assign_expr=$([ -n "$assignment_id" ] && echo "'$assignment_id'::uuid" || echo "NULL")
  psql "$DATABASE_URL" -c "
    INSERT INTO geofence_events
      (machine_id, assignment_id, geofence_type, geofence_id, event_type, lat, lon)
    VALUES (
      '$SIM_MACHINE_ID'::uuid, $assign_expr,
      '$geofence_type', '$geofence_id'::uuid,
      'enter', $centroid_lat, $centroid_lon
    );" 2>/dev/null
  success "Geofence ENTER event recorded"

  # 3. Update assignment status
  if [ -n "$assignment_id" ] && [ "$assignment_status" = "available" ]; then
    psql "$DATABASE_URL" -c "
      UPDATE task_assignments
      SET status='in_progress', actual_start=now(), updated_at=now()
      WHERE id='$assignment_id'::uuid;" 2>/dev/null
    success "Assignment status → in_progress"
  fi

  # 4. Push notification
  if [ -n "$SIM_OPERATOR_ID" ]; then
    if [ "$geofence_type" = "parcel" ]; then
      local dj
      dj=$(
        _P_AID="$assignment_id" _P_NAME="$geofence_name" node -e "
          process.stdout.write(JSON.stringify({
            type:'parcel_entered',
            assignmentId: process.env._P_AID,
            parcelName: process.env._P_NAME
          }));" 2>/dev/null) || dj="{\"type\":\"parcel_entered\"}"
      _sim_push "$SIM_OPERATOR_ID" "Ai intrat pe câmp" \
        "Ai ajuns la $geofence_name." "$dj"
    else
      _sim_push "$SIM_OPERATOR_ID" "Ai ajuns la depozit" \
        "Ești în zona de livrare." \
        "{\"type\":\"deposit_entry\",\"assignmentId\":\"$assignment_id\"}"
    fi
  else
    warn "No operator linked to this machine — push skipped"
  fi
}

# ---------------------------------------------------------------------------
# @cmd sim-exit "Simulate machine exiting its current geofence + push (baler). Args: <machine-or-email>"
# ---------------------------------------------------------------------------
cmd_sim__exit() {
  _load_env
  require_cmd psql
  require_cmd node
  require_cmd curl

  local target="${1:-}"
  if [ -z "$target" ]; then
    error "Usage: ./strawboss.sh sim-exit <machine-or-email>"
    exit 1
  fi

  local dt
  dt=$(date +%Y-%m-%d)
  _sim_resolve_target "$target" "$dt" || exit 1

  info "Machine:  $SIM_MACHINE_CODE ($SIM_MACHINE_TYPE)"
  info "Operator: ${SIM_OPERATOR_EMAIL:-—}"

  # Find last ENTER event for this machine
  local last_row
  last_row=$(psql "$DATABASE_URL" -t -A -c "
    SELECT
      ge.geofence_type,
      ge.geofence_id::text,
      COALESCE(ge.assignment_id::text,''),
      COALESCE(p.name, dd.name, '')
    FROM geofence_events ge
    LEFT JOIN parcels p ON p.id = ge.geofence_id
    LEFT JOIN delivery_destinations dd ON dd.id = ge.geofence_id
    WHERE ge.machine_id = '$SIM_MACHINE_ID'::uuid
      AND ge.event_type = 'enter'
    ORDER BY ge.created_at DESC
    LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true

  if [ -z "$last_row" ]; then
    warn "No prior ENTER event — attempting from today's assignment"
    last_row=$(psql "$DATABASE_URL" -t -A -c "
      SELECT
        CASE WHEN ta.parcel_id IS NOT NULL THEN 'parcel' ELSE 'deposit' END,
        COALESCE(ta.parcel_id::text, ta.destination_id::text, ''),
        ta.id::text,
        COALESCE(p.name, dd.name, 'unknown')
      FROM task_assignments ta
      LEFT JOIN parcels p ON p.id = ta.parcel_id
      LEFT JOIN delivery_destinations dd ON dd.id = ta.destination_id
      WHERE ta.machine_id = '$SIM_MACHINE_ID'::uuid
        AND ta.assignment_date = '$dt'
        AND ta.deleted_at IS NULL
        AND (ta.parcel_id IS NOT NULL OR ta.destination_id IS NOT NULL)
      LIMIT 1;" 2>/dev/null | head -1 | tr -d '\r') || true

    if [ -z "$last_row" ]; then
      error "No geofence context found. Run sim-enter first."; exit 1
    fi
  fi

  local geofence_type geofence_id assignment_id geofence_name
  IFS='|' read -r geofence_type geofence_id assignment_id geofence_name <<< "$last_row"
  geofence_type=$(echo "$geofence_type" | tr -d '[:space:]')
  geofence_id=$(echo "$geofence_id"    | tr -d '[:space:]')
  assignment_id=$(echo "$assignment_id" | tr -d '[:space:]')

  info "Exiting:  $geofence_name ($geofence_type)"

  # 1. Insert GPS outside all geofences (Gulf of Guinea = 0.0, 0.0)
  local op_expr
  op_expr=$([ -n "$SIM_OPERATOR_ID" ] && echo "'$SIM_OPERATOR_ID'::uuid" \
    || echo "(SELECT id FROM users WHERE role='admin' LIMIT 1)")
  psql "$DATABASE_URL" -c "
    INSERT INTO machine_location_events
      (machine_id, operator_id, lat, lon, accuracy_m, recorded_at)
    VALUES ('$SIM_MACHINE_ID'::uuid, $op_expr, 0.0, 0.0, 5.0, now());" \
    2>/dev/null
  success "GPS outside geofence inserted (0.0, 0.0)"

  # 2. Insert geofence EXIT event
  local assign_expr
  assign_expr=$([ -n "$assignment_id" ] && echo "'$assignment_id'::uuid" || echo "NULL")
  psql "$DATABASE_URL" -c "
    INSERT INTO geofence_events
      (machine_id, assignment_id, geofence_type, geofence_id, event_type, lat, lon)
    VALUES (
      '$SIM_MACHINE_ID'::uuid, $assign_expr,
      '$geofence_type', '$geofence_id'::uuid,
      'exit', 0.0, 0.0
    );" 2>/dev/null
  success "Geofence EXIT event recorded"

  # 3. Baler exiting parcel → confirmation push
  if [ "$geofence_type" = "parcel" ] && [ "$SIM_MACHINE_TYPE" = "baler" ] && [ -n "$SIM_OPERATOR_ID" ]; then
    local dj
    dj=$(
      _P_AID="$assignment_id" _P_NAME="$geofence_name" node -e "
        process.stdout.write(JSON.stringify({
          type:'parcel_exit_confirm',
          assignmentId: process.env._P_AID,
          parcelName: process.env._P_NAME
        }));" 2>/dev/null) || dj="{\"type\":\"parcel_exit_confirm\"}"
    _sim_push "$SIM_OPERATOR_ID" "Ai ieșit de pe câmp" \
      "Confirmă finalizarea pentru $geofence_name." "$dj"
  else
    info "No confirmation push for $SIM_MACHINE_TYPE / $geofence_type"
  fi
}

# ---------------------------------------------------------------------------
# @cmd sim-check "Trigger geofence-check BullMQ job immediately (requires Redis)"
# ---------------------------------------------------------------------------
cmd_sim__check() {
  _load_env
  require_cmd node

  local redis_url="${REDIS_URL:-redis://127.0.0.1:6379}"
  info "Triggering BullMQ geofence-check @ $redis_url ..."

  local result
  result=$(
    export _SIM_REDIS_URL="$redis_url"
    cd "$STRAWBOSS_ROOT/backend/service" && node -e "
      const { Queue } = require('bullmq');
      const IORedis = require('ioredis');
      const conn = new IORedis(process.env._SIM_REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      });
      (async () => {
        const q = new Queue('geofence-check', { connection: conn });
        const job = await q.add('sim-manual', {}, {
          jobId: 'sim-' + Date.now(),
          removeOnComplete: true
        });
        await q.close();
        await conn.quit();
        process.stdout.write('job:' + job.id);
      })().catch(e => {
        process.stderr.write(e.message);
        process.exit(1);
      });
    " 2>&1
  ) || true

  if [[ "$result" == job:* ]]; then
    success "Job queued: ${result#job:}"
    info "Geofence check runs within seconds — watch: ./strawboss.sh logs:flow"
  else
    warn "BullMQ trigger failed: $result"
    warn "Is Redis running?  ./strawboss.sh dev starts it automatically"
  fi
}

# ---------------------------------------------------------------------------
# @cmd sim-notif "Send a test push to a user. Args: <email-pattern> <title> <body>"
# ---------------------------------------------------------------------------
cmd_sim__notif() {
  _load_env
  require_cmd psql
  require_cmd node
  require_cmd curl

  local pattern="${1:-}" title="${2:-}" body_msg="${3:-}"
  if [ -z "$pattern" ] || [ -z "$title" ] || [ -z "$body_msg" ]; then
    error "Usage: ./strawboss.sh sim-notif <email-pattern> <title> <body>"
    error "       ./strawboss.sh sim-notif '%dmaletici%' 'Test' 'Hello'"
    exit 1
  fi

  local pat
  pat=$(_sim_sanitize "$pattern")

  local uid email token_count
  uid=$(psql "$DATABASE_URL" -t -A -c "
    SELECT id FROM users
    WHERE deleted_at IS NULL
      AND (email ILIKE '$pat' OR username ILIKE '$pat')
    LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true

  if [ -z "$uid" ]; then
    error "No user matched: $pattern"; exit 1
  fi

  email=$(psql "$DATABASE_URL" -t -A -c "
    SELECT email FROM users WHERE id='$uid'::uuid LIMIT 1;" 2>/dev/null | tr -d '[:space:]') || true
  token_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT count(*)::text FROM device_push_tokens
    WHERE user_id='$uid'::uuid AND is_active=true;" 2>/dev/null | tr -d '[:space:]') || true

  info "Target: $email ($uid)"
  info "Active push tokens: ${token_count:-0}"
  [ "${token_count:-0}" = "0" ] && warn "No active token — open the app logged in as this user first"

  _sim_push "$uid" "$title" "$body_msg"
}

# ---------------------------------------------------------------------------
# @cmd sim-alert "Create a test alert in DB. Args: <machine-or-email> [category=fraud] [severity=high]"
# ---------------------------------------------------------------------------
cmd_sim__alert() {
  _load_env
  require_cmd psql

  local target="${1:-}" category="${2:-fraud}" severity="${3:-high}"
  if [ -z "$target" ]; then
    error "Usage: ./strawboss.sh sim-alert <machine-or-email> [category] [severity]"
    error "Categories: fraud anomaly maintenance safety system"
    error "Severities: low medium high critical"
    exit 1
  fi

  case "$category" in
    fraud|anomaly|maintenance|safety|system) ;;
    *) error "Invalid category '$category'. Valid: fraud anomaly maintenance safety system"; exit 1 ;;
  esac
  case "$severity" in
    low|medium|high|critical) ;;
    *) error "Invalid severity '$severity'. Valid: low medium high critical"; exit 1 ;;
  esac

  _sim_resolve_target "$target" || exit 1

  info "Machine:  $SIM_MACHINE_CODE ($SIM_MACHINE_TYPE)"
  info "Alert:    $category / $severity"

  local ts title description
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  title="[SIM] ${category} ${severity} — ${SIM_MACHINE_CODE:-unknown}"
  description="Simulated $category/$severity alert injected by sim-alert at $ts for QA testing."

  local alert_id
  alert_id=$(psql "$DATABASE_URL" -t -A -c "
    INSERT INTO alerts (id, category, severity, title, description, machine_id, created_at, updated_at)
    VALUES (gen_random_uuid(),'$category','$severity','$title','$description',
            '$SIM_MACHINE_ID'::uuid, now(), now())
    RETURNING id;" 2>/dev/null | head -1 | tr -d '[:space:]') || true

  if [ -n "$alert_id" ]; then
    success "Alert created: $alert_id"
    info "Visible in admin dashboard → Alerts tab"
  else
    error "Alert insert failed — check DATABASE_URL and DB schema"
  fi
}

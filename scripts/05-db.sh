#!/usr/bin/env bash
# ============================================================================
# db.sh — Database commands
# ============================================================================

# @section "Database"

# @cmd db:migrate "Apply supabase/migrations/*.sql"
cmd_db__migrate() {
  header "Running Migrations"
  _load_env
  [ -n "${DATABASE_URL:-}" ] || { error "DATABASE_URL not set in .env"; exit 1; }

  info "Target: ${DATABASE_URL%%@*}@..."
  echo ""
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
  echo ""
  success "Migrations applied."
}

# @cmd db:seed "Run supabase/seed.sql"
cmd_db__seed() {
  header "Seeding Database"
  _load_env
  [ -n "${DATABASE_URL:-}" ] || { error "DATABASE_URL not set in .env"; exit 1; }
  psql "$DATABASE_URL" -f "$STRAWBOSS_ROOT/supabase/seed.sql"
  success "Database seeded."
}

# @cmd db:reset "Migrate + seed"
cmd_db__reset() {
  cmd_db__migrate
  cmd_db__seed
  success "Database reset complete."
}

# @cmd db:status "Check DB connectivity + row counts"
cmd_db__status() {
  header "Database Status"
  _load_env

  if [ -z "${DATABASE_URL:-}" ]; then
    _fail "DATABASE_URL" "not set"
    return 1
  fi

  if ! command -v psql &>/dev/null; then
    _warn "psql" "not installed — cannot probe"
    return 1
  fi

  if psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
    _ok "Connection" "success"
  else
    _fail "Connection" "failed"
    return 1
  fi

  local table_count user_count trip_count machine_count parcel_count
  table_count=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ')
  user_count=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM users WHERE deleted_at IS NULL" 2>/dev/null | tr -d ' ')
  trip_count=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM trips WHERE deleted_at IS NULL" 2>/dev/null | tr -d ' ')
  machine_count=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM machines WHERE deleted_at IS NULL" 2>/dev/null | tr -d ' ')
  parcel_count=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM parcels WHERE deleted_at IS NULL" 2>/dev/null | tr -d ' ')

  echo ""
  _info "Tables"    "${BOLD}${table_count:-?}${NC}"
  _info "Users"     "${BOLD}${user_count:-?}${NC}"
  _info "Trips"     "${BOLD}${trip_count:-?}${NC}"
  _info "Machines"  "${BOLD}${machine_count:-?}${NC}"
  _info "Parcels"   "${BOLD}${parcel_count:-?}${NC}"

  local migration_count
  migration_count=$(find "$STRAWBOSS_ROOT/supabase/migrations" -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')
  _info "Migration files" "${BOLD}$migration_count${NC}"
  echo ""
}

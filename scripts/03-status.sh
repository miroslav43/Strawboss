#!/usr/bin/env bash
# ============================================================================
# status.sh — Status dashboard, health checks, diagnostics
# ============================================================================

# @section "Status & Diagnostics"

# @cmd status "Full dashboard: env, builds, ports, Docker, git"
cmd_status() {
  echo ""
  echo -e "  ${BOLD}${CYAN}▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${NC}"
  echo -e "  ${BOLD}${WHITE}  STRAWBOSS  ${GRAY}status dashboard${NC}"
  echo -e "  ${BOLD}${CYAN}▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀${NC}"

  section "Environment"
  [ -f "$STRAWBOSS_ROOT/.env" ] && _ok ".env" "" || _fail ".env" "${DIM}copy from .env.example${NC}"
  [ -d "$STRAWBOSS_ROOT/node_modules" ] && _ok "node_modules" "" || _fail "node_modules" "${DIM}run setup${NC}"

  local node_v pnpm_v
  node_v=$(node --version 2>/dev/null || echo "missing")
  pnpm_v=$(pnpm --version 2>/dev/null || echo "missing")
  _info "Node" "${BOLD}$node_v${NC}"
  _info "pnpm" "${BOLD}$pnpm_v${NC}"

  if command -v docker &>/dev/null; then
    _ok "Docker" "${DIM}$(docker --version 2>/dev/null | sed 's/Docker version /v/' | cut -d, -f1)${NC}"
  else
    _warn "Docker" "${DIM}not installed${NC}"
  fi

  section "Packages (shared)"
  for pkg in types validation ui-tokens domain api; do
    local dir="$STRAWBOSS_ROOT/packages/$pkg/dist"
    if [ -d "$dir" ]; then
      local age
      age=$(_time_ago "$(_stat_mtime "$dir")")
      _ok "$pkg" "$age"
    else
      _fail "$pkg" "${DIM}not built${NC}"
    fi
  done

  section "Apps"
  [ -d "$STRAWBOSS_ROOT/backend/service/dist" ] \
    && _ok "backend (NestJS)" "" \
    || _fail "backend (NestJS)" "${DIM}not built${NC}"
  [ -d "$STRAWBOSS_ROOT/apps/admin-web/.next" ] \
    && _ok "admin-web (Next.js)" "" \
    || _fail "admin-web (Next.js)" "${DIM}not built${NC}"
  [ -d "$STRAWBOSS_ROOT/apps/mobile/node_modules" ] \
    && _ok "mobile (Expo)" "" \
    || _warn "mobile (Expo)" "${DIM}deps not installed${NC}"

  section "Dev Ports"
  local port_desc=("3000:admin-web" "3001:backend" "6379:Redis" "19000:Expo" "8081:Metro")
  for pd in "${port_desc[@]}"; do
    local port="${pd%%:*}" desc="${pd#*:}"
    if _port_open "$port"; then
      local pid
      pid=$(_port_process "$port")
      _ok ":$port  $desc" "${DIM}PID ${pid:-?}${NC}"
    else
      _info ":$port  $desc" "${DIM}free${NC}"
    fi
  done

  section "Docker Services"
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    local running
    running=$(docker compose ps --status running --format '{{.Name}}|{{.Status}}|{{.Ports}}' 2>/dev/null || true)
    if [ -n "$running" ]; then
      while IFS='|' read -r name status ports; do
        local short_ports
        short_ports=$(echo "$ports" | sed 's/0.0.0.0://g' | cut -c1-40)
        _ok "$name" "${DIM}$short_ports${NC}"
      done <<< "$running"
    else
      _info "No services running" ""
    fi
  else
    _warn "Docker not available" ""
  fi

  section "Disk Usage"
  local nm_size log_size
  nm_size=$(_dir_bytes "$STRAWBOSS_ROOT/node_modules")
  log_size=$(_dir_bytes "$STRAWBOSS_ROOT/logs")
  _info "node_modules" "$(_human_size "$nm_size")"
  _info "Logs" "$(_human_size "$log_size")"

  section "Git"
  local branch dirty
  branch=$(git -C "$STRAWBOSS_ROOT" branch --show-current 2>/dev/null || echo "?")
  dirty=$(git -C "$STRAWBOSS_ROOT" status --porcelain 2>/dev/null | wc -l)
  _info "Branch" "${BOLD}$branch${NC}"
  if [ "$dirty" -gt 0 ] 2>/dev/null; then
    _warn "Uncommitted changes" "${BOLD}$dirty${NC} ${DIM}files${NC}"
  else
    _ok "Working tree" "clean"
  fi
  echo ""
}

# @cmd health "Run all health checks with pass/fail summary"
cmd_health() {
  header "Health Check"

  local pass=0 fail=0 total=0

  _check() {
    total=$(( total + 1 ))
    local label="$1"
    shift
    if "$@" &>/dev/null; then
      _ok "$label"
      pass=$(( pass + 1 ))
    else
      _fail "$label"
      fail=$(( fail + 1 ))
    fi
  }

  section "Prerequisites"
  _check "node installed"          command -v node
  _check "pnpm installed"         command -v pnpm
  _check "git installed"          command -v git
  _check "docker installed"       command -v docker
  _check ".env exists"            test -f "$STRAWBOSS_ROOT/.env"
  _check ".env.example exists"    test -f "$STRAWBOSS_ROOT/.env.example"
  _check "node_modules exists"    test -d "$STRAWBOSS_ROOT/node_modules"
  _check "pnpm-lock.yaml exists"  test -f "$STRAWBOSS_ROOT/pnpm-lock.yaml"

  section "Package Builds"
  _check "types built"       test -d "$STRAWBOSS_ROOT/packages/types/dist"
  _check "validation built"  test -d "$STRAWBOSS_ROOT/packages/validation/dist"
  _check "ui-tokens built"   test -d "$STRAWBOSS_ROOT/packages/ui-tokens/dist"
  _check "domain built"      test -d "$STRAWBOSS_ROOT/packages/domain/dist"
  _check "api built"         test -d "$STRAWBOSS_ROOT/packages/api/dist"

  section "App Builds"
  _check "backend built"     test -d "$STRAWBOSS_ROOT/backend/service/dist"
  _check "admin-web built"   test -d "$STRAWBOSS_ROOT/apps/admin-web/.next"

  section "Services"
  _check "Port 3000 (admin)"   _port_open 3000
  _check "Port 3001 (backend)" _port_open 3001
  _check "Port 6379 (Redis)"   _port_open 6379

  section "Connectivity"
  # Database
  total=$(( total + 1 ))
  if [ -f "$STRAWBOSS_ROOT/.env" ]; then
    # shellcheck disable=SC1091
    source "$STRAWBOSS_ROOT/.env" 2>/dev/null || true
    if [ -n "${DATABASE_URL:-}" ] && command -v psql &>/dev/null; then
      if psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
        _ok "Database" "${DIM}connected${NC}"
        pass=$(( pass + 1 ))
      else
        _fail "Database" "${DIM}cannot connect${NC}"
        fail=$(( fail + 1 ))
      fi
    else
      _info "Database" "${DIM}no DATABASE_URL or psql${NC}"
      pass=$(( pass + 1 ))
    fi
  else
    _info "Database" "${DIM}no .env${NC}"
    pass=$(( pass + 1 ))
  fi

  # Redis
  total=$(( total + 1 ))
  if _port_open 6379; then
    _ok "Redis" "${DIM}port open${NC}"
    pass=$(( pass + 1 ))
  else
    _fail "Redis" "${DIM}port 6379 not open${NC}"
    fail=$(( fail + 1 ))
  fi

  echo ""
  divider
  echo ""
  if [ "$fail" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}✓  All $total checks passed${NC}"
  else
    echo -e "  ${RED}${BOLD}✗  $fail/$total checks failed${NC}  ${DIM}($pass passed)${NC}"
  fi
  echo ""

  [ "$fail" -eq 0 ] && return 0 || return 1
}

# @cmd doctor "Diagnose issues and suggest fixes"
cmd_doctor() {
  header "Doctor"

  local issues=0

  _diagnose() {
    local label="$1" check="$2" fix="$3"
    printf "  ${ARROW}  Checking %-30s" "$label..."
    if eval "$check" &>/dev/null; then
      echo -e "${GREEN}ok${NC}"
    else
      echo -e "${RED}problem${NC}"
      echo -e "     ${YELLOW}Fix:${NC} $fix"
      issues=$(( issues + 1 ))
    fi
  }

  _diagnose ".env file" \
    "test -f '$STRAWBOSS_ROOT/.env'" \
    "cp .env.example .env && edit .env"

  _diagnose "node_modules" \
    "test -d '$STRAWBOSS_ROOT/node_modules'" \
    "./strawboss.sh setup"

  _diagnose "pnpm available" \
    "command -v pnpm" \
    "corepack enable && corepack prepare pnpm@latest --activate"

  _diagnose "packages built" \
    "test -d '$STRAWBOSS_ROOT/packages/types/dist' && test -d '$STRAWBOSS_ROOT/packages/api/dist'" \
    "./strawboss.sh build packages"

  _diagnose "Docker daemon" \
    "docker info" \
    "sudo systemctl start docker  ${DIM}(or open Docker Desktop on macOS)${NC}"

  # Check for stale builds
  for pkg in types validation ui-tokens domain api; do
    if [ -d "$STRAWBOSS_ROOT/packages/$pkg/dist" ] && [ -d "$STRAWBOSS_ROOT/packages/$pkg/src" ]; then
      local src_mod
      src_mod=$(find "$STRAWBOSS_ROOT/packages/$pkg/src" -name '*.ts' -newer "$STRAWBOSS_ROOT/packages/$pkg/dist" 2>/dev/null | head -1)
      if [ -n "$src_mod" ]; then
        issues=$(( issues + 1 ))
        echo -e "  ${WARN}  Package ${BOLD}$pkg${NC} has source changes newer than dist/"
        echo -e "     ${YELLOW}Fix:${NC} ./strawboss.sh build $pkg"
      fi
    fi
  done

  echo ""
  divider
  echo ""
  if [ "$issues" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}✓  No issues found. Everything looks good!${NC}"
  else
    echo -e "  ${YELLOW}${BOLD}⚠  Found $issues issue(s) to address.${NC}"
  fi
  echo ""
}

# @cmd info "Show versions, SDK info, env vars"
cmd_info() {
  header "System Info"

  section "Runtime"
  _info "OS"            "${BOLD}${STRAWBOSS_OS}${NC} ($(uname -s) $(uname -m))"
  _info "Node.js"       "$(node --version 2>/dev/null || echo 'not installed')"
  _info "pnpm"          "$(pnpm --version 2>/dev/null || echo 'not installed')"
  _info "Docker"        "$(docker --version 2>/dev/null | sed 's/Docker version //' | cut -d, -f1 || echo 'not installed')"
  _info "Git"           "$(git --version 2>/dev/null | sed 's/git version //' || echo 'not installed')"

  section "Mobile SDK"
  _info "Java" "$(java -version 2>&1 | head -1 || echo 'not installed')"
  if _mobile_resolve_android_home 2>/dev/null; then
    _info "ANDROID_HOME" "$ANDROID_HOME"
  else
    _warn "ANDROID_HOME" "not found"
  fi

  section "Project"
  _info "Root"           "$STRAWBOSS_ROOT"
  _info "Expo SDK"       "$(grep '"expo":' "$STRAWBOSS_ROOT/apps/mobile/package.json" 2>/dev/null | grep -oE '[0-9]+\.[0-9.]+' | head -1 || echo '?')"
  _info "React Native"   "$(grep '"react-native":' "$STRAWBOSS_ROOT/apps/mobile/package.json" 2>/dev/null | grep -oE '[0-9]+\.[0-9.]+' | head -1 || echo '?')"
  _info "NestJS"         "$(grep '"@nestjs/core":' "$STRAWBOSS_ROOT/backend/service/package.json" 2>/dev/null | grep -oE '[0-9]+\.[0-9.]+' | head -1 || echo '?')"
  _info "Next.js"        "$(grep '"next":' "$STRAWBOSS_ROOT/apps/admin-web/package.json" 2>/dev/null | grep -oE '[0-9]+\.[0-9.]+' | head -1 || echo '?')"

  local migration_count
  migration_count=$(find "$STRAWBOSS_ROOT/supabase/migrations" -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')
  _info "DB migrations"  "$migration_count files"

  section "Environment Variables"
  if [ -f "$STRAWBOSS_ROOT/.env" ]; then
    local env_count
    env_count=$(grep -cE '^[A-Z]' "$STRAWBOSS_ROOT/.env" 2>/dev/null || echo "0")
    _info ".env" "$env_count variables set"
    # shellcheck disable=SC1091
    source "$STRAWBOSS_ROOT/.env" 2>/dev/null || true
    for var in DATABASE_URL SUPABASE_URL SUPABASE_JWT_SECRET \
               NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_API_URL \
               EXPO_PUBLIC_API_URL EXPO_PUBLIC_SUPABASE_URL; do
      if [ -n "${!var:-}" ]; then
        _ok "$var" "${DIM}set${NC}"
      else
        _warn "$var" "${DIM}not set${NC}"
      fi
    done
  else
    _fail ".env" "missing"
  fi
  echo ""
}

# @cmd ports "Show all dev port usage"
cmd_ports() {
  header "Port Status"

  local all_ports=("3000:admin-web (Next.js)" "3001:backend (NestJS/Fastify)" "6379:Redis"
                   "5432:PostgreSQL" "19000:Expo Dev Server" "19001:Expo Metro" "8081:Metro fallback"
                   "80:nginx HTTP" "443:nginx HTTPS")

  for pd in "${all_ports[@]}"; do
    local port="${pd%%:*}" desc="${pd#*:}"
    if _port_open "$port"; then
      local pid pname=""
      pid=$(_port_process "$port")
      if [ -n "$pid" ]; then
        pname=$(ps -p "$pid" -o comm= 2>/dev/null || echo "?")
      fi
      printf "  ${GREEN}●${NC}  ${BOLD}:%-5s${NC}  %-30s  ${DIM}PID %-6s %s${NC}\\n" "$port" "$desc" "${pid:-?}" "$pname"
    else
      printf "  ${GRAY}○${NC}  ${GRAY}:%-5s${NC}  ${GRAY}%-30s  free${NC}\\n" "$port" "$desc"
    fi
  done
  echo ""
}

# @cmd size "Disk usage breakdown by package"
cmd_size() {
  header "Disk Usage Breakdown"

  section "Packages"
  for pkg in types validation ui-tokens domain api; do
    printf "  %-16s %s\\n" "$pkg" "$(_human_size "$(_dir_bytes "$STRAWBOSS_ROOT/packages/$pkg")")"
  done

  section "Apps"
  for app in "backend/service:backend" "apps/admin-web:admin-web" "apps/mobile:mobile"; do
    local dir="${app%%:*}" name="${app#*:}"
    printf "  %-16s %s\\n" "$name" "$(_human_size "$(_dir_bytes "$STRAWBOSS_ROOT/$dir")")"
  done

  section "Other"
  printf "  %-16s %s\\n" "node_modules" "$(_human_size "$(_dir_bytes "$STRAWBOSS_ROOT/node_modules")")"
  printf "  %-16s %s\\n" "logs" "$(_human_size "$(_dir_bytes "$STRAWBOSS_ROOT/logs")")"
  printf "  %-16s %s\\n" ".git" "$(_human_size "$(_dir_bytes "$STRAWBOSS_ROOT/.git")")"

  echo ""
  divider
  local total
  if [ "$STRAWBOSS_OS" = "macos" ]; then
    total=$(du -sk "$STRAWBOSS_ROOT" 2>/dev/null | cut -f1)
    total=$(( ${total:-0} * 1024 ))
  else
    total=$(du -sb "$STRAWBOSS_ROOT" 2>/dev/null | cut -f1 || echo "0")
  fi
  echo -e "  ${BOLD}Total:${NC} $(_human_size "$total")"
  echo ""
}

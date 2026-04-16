#!/usr/bin/env bash
# ============================================================================
# build.sh — Build, typecheck, lint, clean
# ============================================================================

# @section "Build & Code Quality"

# @cmd install "Install all dependencies via pnpm"
cmd_install() {
  header "Installing dependencies"
  require_cmd pnpm
  pnpm install
  success "Dependencies installed."
}

# @cmd build "Build packages/apps (packages|all|types|api|backend|admin|...)"
cmd_build() {
  local target="${1:-all}"
  header "Building: $target"
  require_cmd pnpm

  case "$target" in
    types)      pnpm --filter @strawboss/types build ;;
    validation) pnpm --filter @strawboss/types build && pnpm --filter @strawboss/validation build ;;
    ui-tokens)  pnpm --filter @strawboss/ui-tokens build ;;
    domain)     pnpm --filter @strawboss/types build && pnpm --filter @strawboss/domain build ;;
    api)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/api build
      ;;
    backend)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/domain build
      pnpm --filter @strawboss/backend build
      ;;
    admin)
      pnpm --filter @strawboss/types build
      pnpm --filter @strawboss/validation build
      pnpm --filter @strawboss/ui-tokens build
      pnpm --filter @strawboss/api build
      pnpm --filter @strawboss/admin-web build
      ;;
    packages)  _build_packages ;;
    all)
      _build_packages
      pnpm --filter @strawboss/backend build
      pnpm --filter @strawboss/admin-web build
      ;;
    *)
      error "Unknown target: $target"
      echo "  Targets: types | validation | ui-tokens | domain | api | backend | admin | packages | all"
      exit 1
      ;;
  esac

  success "Build complete: $target"
}

# @cmd typecheck "TypeScript check (all or package name)"
cmd_typecheck() {
  local target="${1:-all}"
  header "Typechecking: $target"
  require_cmd pnpm

  local failed=0
  _run_check() {
    local name="$1" filter="$2"
    printf "  ${ARROW}  %-20s" "$name"
    if pnpm --filter "$filter" typecheck &>/dev/null; then
      echo -e "${GREEN}pass${NC}"
    else
      echo -e "${RED}FAIL${NC}"
      failed=1
    fi
  }

  case "$target" in
    all)
      _run_check "types"      "@strawboss/types"
      _run_check "validation" "@strawboss/validation"
      _run_check "ui-tokens"  "@strawboss/ui-tokens"
      _run_check "domain"     "@strawboss/domain"
      _run_check "api"        "@strawboss/api"
      _run_check "backend"    "@strawboss/backend"
      _run_check "admin-web"  "@strawboss/admin-web"
      _run_check "mobile"     "@strawboss/mobile"
      echo ""
      ;;
    *)
      pnpm --filter "@strawboss/$target" typecheck
      ;;
  esac

  [ "$failed" -eq 0 ] && success "All typechecks passed." || { error "Some typechecks failed."; exit 1; }
}

# @cmd lint "ESLint across all packages"
cmd_lint() {
  header "Linting"
  require_cmd pnpm
  pnpm lint
  success "Lint passed."
}

# @cmd clean "Remove dist/ and .next/ build artifacts"
cmd_clean() {
  header "Cleaning build artifacts"
  local dirs=(
    "packages/types/dist" "packages/validation/dist" "packages/ui-tokens/dist"
    "packages/domain/dist" "packages/api/dist"
    "backend/service/dist" "apps/admin-web/.next"
  )
  for dir in "${dirs[@]}"; do
    local full="$STRAWBOSS_ROOT/$dir"
    if [ -d "$full" ]; then
      rm -rf "$full"
      info "Removed $dir"
    fi
  done
  find "$STRAWBOSS_ROOT" -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete 2>/dev/null || true
  rm -rf "$STRAWBOSS_ROOT/.turbo" 2>/dev/null || true
  success "Clean complete."
}

# @cmd clean:all "Remove dist/ AND node_modules/"
cmd_clean__all() {
  cmd_clean
  header "Removing node_modules"
  find "$STRAWBOSS_ROOT" -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  success "node_modules removed. Run ${BOLD}./strawboss.sh setup${NC} to reinstall."
}

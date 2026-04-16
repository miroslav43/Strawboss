#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# strawboss.sh — StrawBoss monorepo orchestrator
#
# Thin router that sources scripts/_lib.sh + scripts/*.sh, then dispatches
# the requested command to the matching cmd_*() function.
#
# Adding a new command:
#   1. Open (or create) the relevant scripts/<category>.sh
#   2. Add a function with the @cmd annotation:
#        # @cmd my-command "Description shown in help"
#        cmd_my__command() { ... }
#   3. Done — it appears in help and routing automatically.
#
# Naming: command "foo:bar-baz" maps to function cmd_foo__bar__baz()
#         (colons and hyphens become double underscores)
# ============================================================================

export STRAWBOSS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$STRAWBOSS_ROOT"

# ---------------------------------------------------------------------------
# Source library and all category scripts
# ---------------------------------------------------------------------------
# shellcheck source=scripts/_lib.sh
source "$STRAWBOSS_ROOT/scripts/_lib.sh"

for _f in "$STRAWBOSS_ROOT"/scripts/[!_]*.sh; do
  # shellcheck disable=SC1090
  source "$_f"
done
unset _f

# ---------------------------------------------------------------------------
# Auto-generated help from @cmd / @section annotations
# ---------------------------------------------------------------------------
_auto_help() {
  echo ""
  echo -e "  ${BOLD}${GREEN}"
  echo '   ____  _                    ____'
  echo '  / ___|| |_ _ __ __ ___  __| __ )  ___  ___ ___'
  echo '  \___ \| __| `__/ _` \ \/ /|  _ \ / _ \/ __/ __|'
  echo '   ___) | |_| | | (_| |>  < | |_) | (_) \__ \__ \'
  echo '  |____/ \__|_|  \__,_/_/\_\|____/ \___/|___/___/'
  echo -e "  ${NC}"
  echo -e "  ${DIM}Monorepo control centre — run any command below${NC}"
  echo ""

  local current_section=""

  # Parse all scripts for @section and @cmd annotations, in file order
  for f in "$STRAWBOSS_ROOT"/scripts/[!_]*.sh; do
    while IFS= read -r line; do
      # @section "Name"
      if [[ "$line" =~ ^#[[:space:]]*@section[[:space:]]+\"(.+)\" ]]; then
        current_section="${BASH_REMATCH[1]}"
        echo -e "  ${BOLD}${WHITE}${current_section}${NC}"
      # @cmd command-name "description"
      elif [[ "$line" =~ ^#[[:space:]]*@cmd[[:space:]]+([^[:space:]]+)[[:space:]]+\"(.+)\" ]]; then
        local cmd_name="${BASH_REMATCH[1]}"
        local cmd_desc="${BASH_REMATCH[2]}"
        printf "    ${CYAN}%-26s${NC} %s\\n" "$cmd_name" "$cmd_desc"
      fi
    done < "$f"
    # Add blank line after each file's section
    if [ -n "$current_section" ]; then
      echo ""
      current_section=""
    fi
  done

  divider
  echo ""
  echo -e "  ${DIM}Quick start:  ${NC}${BOLD}./strawboss.sh setup${NC}${DIM}  then  ${NC}${BOLD}./strawboss.sh dev${NC}"
  echo -e "  ${DIM}Mobile:       ${NC}${BOLD}./strawboss.sh mobile-build-local${NC}${DIM}  then  ${NC}${BOLD}./strawboss.sh mobile-install${NC}"
  echo -e "  ${DIM}Platform:     ${NC}${BOLD}${STRAWBOSS_OS}${NC}${DIM}  ($(uname -s) $(uname -m))${NC}"
  echo ""
}

# ---------------------------------------------------------------------------
# Command router
# ---------------------------------------------------------------------------
COMMAND="${1:-help}"
shift 2>/dev/null || true

if [ "$COMMAND" = "help" ] || [ "$COMMAND" = "--help" ] || [ "$COMMAND" = "-h" ]; then
  _auto_help
  exit 0
fi

# Convert command name to function name:  "db:migrate" → "cmd_db__migrate"
FUNC_NAME="cmd_$(echo "$COMMAND" | sed 's/[-:]/__/g')"

if declare -f "$FUNC_NAME" &>/dev/null; then
  "$FUNC_NAME" "$@"
else
  error "Unknown command: ${BOLD}$COMMAND${NC}"
  echo ""
  echo -e "  Run ${BOLD}./strawboss.sh help${NC} for all commands."
  echo -e "  ${DIM}Or ./strawboss.sh status for a quick dashboard.${NC}"
  exit 1
fi

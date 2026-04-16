#!/usr/bin/env bash
# ============================================================================
# logs.sh — Log viewing and management
# ============================================================================

# @section "Logs"

_logs_today_path() {
  echo "$STRAWBOSS_ROOT/logs/$1/$(date +%Y-%m-%d).log"
}

_logs_tail() {
  local rel="${1:-web/all}"
  local f
  f="$(_logs_today_path "$rel")"
  if [ ! -f "$f" ]; then
    warn "No log file yet: $f"
    info "Start the backend to generate logs."
    exit 1
  fi
  tail -f "$f"
}

# @cmd logs "Tail today's web/all log"
cmd_logs() {
  _logs_tail web/all
}

# @cmd logs:error "Tail today's error log"
cmd_logs__error() {
  _logs_tail web/error
}

# @cmd logs:flow "Tail today's flow log (business events)"
cmd_logs__flow() {
  _logs_tail web/flow
}

# @cmd logs:http "Tail today's HTTP request log"
cmd_logs__http() {
  _logs_tail web/http
}

# @cmd logs:mobile "Tail today's mobile log (uploaded from devices)"
cmd_logs__mobile() {
  _logs_tail mobile/all
}

# @cmd logs:count "Show log file sizes and line counts"
cmd_logs__count() {
  header "Log File Summary"
  local today
  today=$(date +%Y-%m-%d)

  if [ ! -d "$STRAWBOSS_ROOT/logs" ]; then
    info "No logs directory yet."
    return
  fi

  section "Today ($today)"
  for category in web/all web/error web/warn web/flow web/http mobile/all; do
    local f="$STRAWBOSS_ROOT/logs/$category/$today.log"
    if [ -f "$f" ]; then
      local lines sz
      lines=$(wc -l < "$f" | tr -d ' ')
      sz=$(_stat_size "$f")
      printf "  %-20s ${BOLD}%6d${NC} lines  ${DIM}%s${NC}\\n" "$category" "$lines" "$(_human_size "$sz")"
    else
      printf "  %-20s ${GRAY}no file${NC}\\n" "$category"
    fi
  done

  section "Disk Usage"
  local total_sz
  total_sz=$(_dir_bytes "$STRAWBOSS_ROOT/logs")
  _info "Total logs" "$(_human_size "$total_sz")"

  local file_count
  file_count=$(find "$STRAWBOSS_ROOT/logs" -type f 2>/dev/null | wc -l | tr -d ' ')
  _info "Log files" "$file_count"
  echo ""
}

# @cmd logs:clean "Delete all log files"
cmd_logs__clean() {
  if [ -d "$STRAWBOSS_ROOT/logs" ]; then
    rm -rf "${STRAWBOSS_ROOT:?}/logs"/*
    success "Cleared $STRAWBOSS_ROOT/logs/"
  else
    info "No logs directory yet."
  fi
}

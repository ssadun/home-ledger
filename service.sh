#!/bin/bash
# Hyper Ledger - Frontend Dev Server Service Manager
# Usage: bash service.sh {start|stop|status|restart}
#
# Serves the frontend natively (no Docker) via dev-server.py on port 8088,
# with no caching and an /api proxy to the backend container on port 8100.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${SCRIPT_DIR}/hyper-ledger-web.pid"
LOG_FILE="${SCRIPT_DIR}/logs/hyper-ledger-web.log"
SERVER_SCRIPT="${SCRIPT_DIR}/dev-server.py"

SERVICE_NAME="Hyper Ledger Web"
SERVICE_ICON="📒"
PORT="${PORT:-8088}"
HOST="${HOST:-nas-docker}"

# Verify whether a PID belongs to this Hyper Ledger dev server instance
is_our_server_pid() {
  local pid="$1"

  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  if [ ! -f "/proc/$pid/cmdline" ]; then
    return 1
  fi

  local cmdline
  cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)

  # Preferred match: absolute script path
  if echo "$cmdline" | grep -Fq " $SERVER_SCRIPT"; then
    return 0
  fi

  # Backward compatibility: older starts used relative "dev-server.py"
  if echo "$cmdline" | grep -Eq '(^|[[:space:]])dev-server\.py([[:space:]]|$)'; then
    if [ -L "/proc/$pid/cwd" ]; then
      local cwd
      cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null)
      if [ "$cwd" = "$SCRIPT_DIR" ] || [ "$cwd" = "${SCRIPT_DIR}/frontend" ]; then
        return 0
      fi
    fi
  fi

  return 1
}

# Find Python 3 on Synology
find_python() {
  local PY_PATHS=(
    "/usr/local/bin/python3"
    "/opt/bin/python3"
    "/bin/python3"
    "/usr/bin/python3"
    "/var/packages/Python3.9/target/bin/python3"
    "/var/packages/Python3.10/target/bin/python3"
    "/var/packages/Python3.11/target/bin/python3"
  )

  for p in "${PY_PATHS[@]}"; do
    if [ -x "$p" ]; then
      echo "$p"
      return
    fi
  done

  # Fallback to PATH
  local PY=$(which python3 2>/dev/null)
  if [ -n "$PY" ]; then
    echo "$PY"
    return
  fi

  echo ""
}

# Get the PID of the running service
get_pid() {
  local pid=""

  # Check PID file first
  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if is_our_server_pid "$pid"; then
      echo "$pid"
      return
    fi
    # Stale PID file - remove it
    rm -f "$PID_FILE"
  fi

  # Search for a running dev-server.py process in this directory
  for pid in $(pgrep -f "dev-server.py" 2>/dev/null); do
    if is_our_server_pid "$pid"; then
      # Found it - save PID for future
      echo "$pid" > "$PID_FILE"
      echo "$pid"
      return
    fi
  done

  # No Hyper Ledger process found
  rm -f "$PID_FILE"
}

# Start the service
do_start() {
  local RUNNING_PID=$(get_pid)
  if [ -n "$RUNNING_PID" ]; then
    echo "⚠️  ${SERVICE_NAME} is already running (PID: $RUNNING_PID)"
    return 0
  fi

  echo "${SERVICE_ICON} ${SERVICE_NAME}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Find Python 3
  local PYTHON=$(find_python)
  if [ -z "$PYTHON" ]; then
    echo "❌ Python 3 not found. Install it via Synology Package Center."
    return 1
  fi

  echo "✅ Python: $($PYTHON --version 2>&1) at $PYTHON"
  echo "✅ Port: ${PORT}"
  echo ""

  # Start the server in background
  cd "$SCRIPT_DIR"
  mkdir -p logs
  PORT="$PORT" nohup "$PYTHON" "$SERVER_SCRIPT" >> "$LOG_FILE" 2>&1 &
  local SERVER_PID=$!
  echo $SERVER_PID > "$PID_FILE"

  # Wait briefly and check if it started
  sleep 1
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✅ ${SERVICE_NAME} started (PID: $SERVER_PID)"
    echo "   Open: http://${HOST}:${PORT}"
    echo "   Log:  $LOG_FILE"
    echo ""
  else
    echo "❌ Failed to start ${SERVICE_NAME}. Check log: $LOG_FILE"
    return 1
  fi
}

# Stop the service
# Usage: do_stop [--force]
do_stop() {
  local FORCE=0
  if [ "$1" = "--force" ] || [ "$1" = "-f" ]; then
    FORCE=1
  fi

  local PIDS=$(get_pid)
  if [ -z "$PIDS" ]; then
    echo "ℹ️  ${SERVICE_NAME} is not running."
    rm -f "$PID_FILE"
    return 0
  fi

  echo "${SERVICE_ICON} ${SERVICE_NAME}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔍 Found process(es): $PIDS"

  for PID in $PIDS; do
    kill "$PID" 2>/dev/null && echo "✅ Stopped PID $PID" || echo "❌ Failed to stop PID $PID"
  done

  # Verify this service is gone without matching unrelated python processes
  sleep 1
  local STILL_RUNNING=$(get_pid)
  if [ -z "$STILL_RUNNING" ]; then
    rm -f "$PID_FILE"
    echo ""
    echo "✅ ${SERVICE_NAME} stopped."
  else
    if [ "$FORCE" -eq 1 ]; then
      echo ""
      echo "⚠️  Process still running. Force killing..."
      for PID in $STILL_RUNNING; do
        kill -9 "$PID" 2>/dev/null && echo "✅ Force killed PID $PID" || echo "❌ Failed to force kill PID $PID"
      done
      sleep 0.5
      STILL_RUNNING=$(get_pid)
      if [ -z "$STILL_RUNNING" ]; then
        rm -f "$PID_FILE"
        echo ""
        echo "✅ ${SERVICE_NAME} force stopped."
      else
        echo ""
        echo "❌ ${SERVICE_NAME} could not be stopped."
        return 1
      fi
    else
      echo ""
      echo "⚠️  ${SERVICE_NAME} may still be running."
      echo "   Use 'bash service.sh stop --force' to force kill."
      return 1
    fi
  fi
}

# Show service status
do_status() {
  local RUNNING_PID=$(get_pid)
  if [ -z "$RUNNING_PID" ]; then
    echo "ℹ️  ${SERVICE_NAME} is not running."
    return 1
  fi

  echo "${SERVICE_ICON} ${SERVICE_NAME}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Status: Running"
  echo "   PID:  $RUNNING_PID"
  echo "   Port: ${PORT}"

  # Get uptime and memory from /proc
  if [ -f "/proc/$RUNNING_PID/stat" ]; then
    local MEM_KB=$(awk '/VmRSS/{print $2}' /proc/$RUNNING_PID/status 2>/dev/null)
    if [ -n "$MEM_KB" ]; then
      echo "   Mem:  $((MEM_KB / 1024))MB"
    fi

    # Calculate uptime from process starttime
    local START_TICKS=$(awk '{print $22}' /proc/$RUNNING_PID/stat)
    local CLK_TCK=100
    local BOOT_TIME=$(awk '/btime/{print $2}' /proc/stat)
    local START_EPOCH=$((BOOT_TIME + START_TICKS / CLK_TCK))
    local UPTIME=$(( $(date +%s) - START_EPOCH ))

    local DAYS=$((UPTIME / 86400))
    local HOURS=$(( (UPTIME % 86400) / 3600 ))
    local MINS=$(( (UPTIME % 3600) / 60 ))
    echo "   Up:   ${DAYS}d ${HOURS}h ${MINS}m"
  fi

  # Show log file size if it exists
  if [ -f "$LOG_FILE" ]; then
    local LOG_SIZE=$(du -h "$LOG_FILE" 2>/dev/null | cut -f1)
    echo "   Log:  $LOG_FILE ($LOG_SIZE)"
  fi

  echo ""
  echo "   Open: http://${HOST}:${PORT}"
}

# Restart the service
do_restart() {
  echo "🔄 Restarting ${SERVICE_NAME}..."
  echo ""
  do_stop
  echo ""
  sleep 1
  do_start
}

# Main
case "${1}" in
  start)
    do_start
    ;;
  stop)
    do_stop "$2"
    ;;
  status)
    do_status
    ;;
  restart)
    do_restart
    ;;
  *)
    echo "${SERVICE_ICON} ${SERVICE_NAME} Service Manager"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Usage: bash service.sh {start|stop|status|restart}"
    echo ""
    echo "Commands:"
    echo "  start         - Start the Hyper Ledger web dev server"
    echo "  stop          - Stop the Hyper Ledger web dev server"
    echo "  stop --force  - Force kill if graceful stop fails"
    echo "  status        - Show current service status"
    echo "  restart       - Restart the service"
    echo ""
    echo "Examples:"
    echo "  bash service.sh start"
    echo "  bash service.sh status"
    echo "  bash service.sh stop --force"
    echo "  bash service.sh restart"
    echo ""
    return 1 2>/dev/null || exit 1
    ;;
esac

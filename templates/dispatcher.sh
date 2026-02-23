#!/bin/bash
# Copilot Hive — Pipeline Dispatcher (runs every 1 min via cron)
# Chains: Developer → Deploy → Version Verify → Auditor → loop

STATUS_FILE="{{SCRIPTS_DIR}}/.pipeline-status"
PROJECT_DIR="{{PROJECT_DIR}}"
VERSION_URL="{{VERSION_URL}}"
COPILOT="/usr/local/bin/copilot"

source "$STATUS_FILE" 2>/dev/null

check_deploy() {
  local commit="$1"
  RUNNING_VER=$(curl -sf "$VERSION_URL" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('build_id',''))" 2>/dev/null)
  [ "$RUNNING_VER" = "$LAST_BUILD_ID" ] && echo "verified" || echo "waiting"
}

# See full implementation in copilot-dispatcher.sh

#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Project-Aware Agent Runner
#  Usage: run-agent.sh <agent-name> --project <project-id>
#  Example: run-agent.sh radical --project my-saas-app
# ══════════════════════════════════════════════════════════════════════

HIVE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Parse agent name (first arg)
AGENT_NAME="${1:?Usage: run-agent.sh <agent-name> --project <project-id>}"
shift

# Map agent name to script
AGENT_SCRIPT="${HIVE_DIR}/copilot-${AGENT_NAME}.sh"

if [ ! -f "$AGENT_SCRIPT" ]; then
  echo "ERROR: Agent script not found: $AGENT_SCRIPT" >&2
  echo "Available agents:" >&2
  ls "${HIVE_DIR}"/copilot-*.sh 2>/dev/null | sed 's|.*/copilot-||;s|\.sh$||' | sed 's/^/  /' >&2
  exit 1
fi

# Load project context (exports env vars)
source "${HIVE_DIR}/lib/load-project.sh"
load_project_context "$@" || exit 1

if [ -n "$PROJECT_ID" ]; then
  echo "$(date) — Running ${AGENT_NAME} for project: ${PROJECT_ID} (${PROJECT_NAME})" >&2
fi

# Run the agent script (it will pick up exported env vars)
exec "$AGENT_SCRIPT" "$@"

#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Run Agent Across All Projects
#  Usage: run-all-projects.sh <agent-name> [extra-args...]
#  Example: run-all-projects.sh radical
#           run-all-projects.sh reporter daily
#
#  Iterates over all projects in projects/registry.json and runs
#  the specified agent for each one sequentially (to avoid overloading).
# ══════════════════════════════════════════════════════════════════════

HIVE_DIR="$(cd "$(dirname "$0")" && pwd)"
REGISTRY="${HIVE_DIR}/projects/registry.json"
RUN_AGENT="${HIVE_DIR}/run-agent.sh"

AGENT="${1:?Usage: run-all-projects.sh <agent-name> [extra-args...]}"
shift
EXTRA_ARGS="$@"

# Check prerequisites
[ ! -f "$REGISTRY" ] && echo "No projects registered yet." && exit 0
[ ! -x "$RUN_AGENT" ] && echo "ERROR: run-agent.sh not found" && exit 1

# Get project IDs from registry
PROJECT_IDS=$(python3 -c "
import json, sys
try:
    with open('${REGISTRY}') as f:
        data = json.load(f)
    projects = data if isinstance(data, list) else data.get('projects', [])
    for p in projects:
        pid = p.get('id', '')
        if pid:
            print(pid)
except Exception as e:
    print(f'Error reading registry: {e}', file=sys.stderr)
" 2>/dev/null)

if [ -z "$PROJECT_IDS" ]; then
  echo "$(date) — No projects found in registry. Running agent in default mode."
  exec "${HIVE_DIR}/copilot-${AGENT}.sh" $EXTRA_ARGS
fi

# Run agent for each project
COUNT=0
for project_id in $PROJECT_IDS; do
  # Check if project is paused
  PAUSE_FILE="${HIVE_DIR}/projects/${project_id}/.agents-paused"
  if [ -f "$PAUSE_FILE" ]; then
    echo "$(date) — SKIPPED: ${AGENT} for ${project_id} (project paused)"
    continue
  fi

  # Check if agent is enabled for this project
  ENABLED=$(python3 -c "
import json
try:
    with open('${HIVE_DIR}/projects/${project_id}/project.json') as f:
        p = json.load(f)
    agents = p.get('agents', [])
    print('yes' if '${AGENT}' in agents or not agents else 'no')
except: print('yes')
" 2>/dev/null)

  if [ "$ENABLED" = "no" ]; then
    echo "$(date) — SKIPPED: ${AGENT} not enabled for ${project_id}"
    continue
  fi

  echo "$(date) — Running ${AGENT} for project: ${project_id}"
  "$RUN_AGENT" "$AGENT" --project "$project_id" $EXTRA_ARGS
  COUNT=$((COUNT + 1))
  
  # Brief pause between projects to avoid overwhelming the system
  [ $COUNT -gt 0 ] && sleep 5
done

echo "$(date) — Finished ${AGENT} for ${COUNT} project(s)"

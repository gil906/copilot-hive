#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive v2.0 — Shared Agent Helpers & Context-Mode Bridge
#  Sourced by all copilot-*.sh agents for unified status reporting,
#  multi-project context loading, urgent admin overrides, and
#  mksglu/context-mode knowledge base indexing & retrieval.
# ══════════════════════════════════════════════════════════════════════

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="$(cd "${_HELPERS_DIR}/.." && pwd)"

# Ensure project loader is sourced
if ! declare -f load_project_context >/dev/null 2>&1; then
  [ -f "${_HELPERS_DIR}/load-project.sh" ] && source "${_HELPERS_DIR}/load-project.sh"
fi

# Initialize agent paths, project context, and pause/lock checks
init_agent_env() {
  local agent_id="$1"
  shift || true

  # Load --project <id> if passed on command line or env
  if declare -f load_project_context >/dev/null 2>&1; then
    load_project_context "$@" || true
  fi

  export CURRENT_AGENT_ID="$agent_id"
  export LOG_DIR="${LOG_DIR:-${SCRIPTS_DIR:-$HIVE_ROOT}}"
  export IDEAS_DIR="${IDEAS_DIR:-${SCRIPTS_DIR:-$HIVE_ROOT}/ideas}"
  export CHANGELOG_DIR="${CHANGELOG_DIR:-${SCRIPTS_DIR:-$HIVE_ROOT}/changelogs}"
  export AGENT_STATUS_FILE="${AGENT_STATUS_FILE:-${IDEAS_DIR}/agent_status.json}"
  export PIPELINE_STATUS_FILE="${PIPELINE_STATUS_FILE:-${SCRIPTS_DIR:-$HIVE_ROOT}/.pipeline-status}"
  export LOG_FILE="${LOG_DIR}/copilot-${agent_id}${PROJECT_LOG_SUFFIX:-}.log"
  export PAUSE_FILE="${PAUSE_FILE:-${SCRIPTS_DIR:-$HIVE_ROOT}/.agents-paused}"
  export AGENT_PAUSE_FILE="${SCRIPTS_DIR:-$HIVE_ROOT}/.agent-paused-${agent_id}"
  if [ -n "${PROJECT_ID:-}" ]; then
    export PROJECT_AGENT_PAUSE_FILE="${HIVE_ROOT}/projects/${PROJECT_ID}/.agent-paused-${agent_id}"
  else
    export PROJECT_AGENT_PAUSE_FILE=""
  fi

  mkdir -p "$LOG_DIR" "$IDEAS_DIR" "$CHANGELOG_DIR"
}

# Check if global, project, or individual agent is paused
check_agent_paused() {
  local agent_id="${1:-${CURRENT_AGENT_ID:-unknown}}"
  if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ] || { [ -n "${PROJECT_AGENT_PAUSE_FILE:-}" ] && [ -f "$PROJECT_AGENT_PAUSE_FILE" ]; }; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') — SKIPPED: Agent ${agent_id} paused by admin" >> "$LOG_FILE"
    exit 0
  fi
}

# Atomic update of agent_status.json (never collides with .pipeline-status!)
update_agent_status() {
  local agent_id="$1"
  local status="$2"
  local step="${3:-}"
  local exit_code="${4:-}"
  local target_file="${AGENT_STATUS_FILE:-${IDEAS_DIR}/agent_status.json}"

  python3 - "$target_file" "$agent_id" "$status" "$step" "$exit_code" "${PROJECT_ID:-default}" "${HIVE_TOPOLOGY:-adaptive-swarm}" <<'PYEOF' 2>/dev/null || true
import sys, json, datetime, os

f, agent_id, status, step, ec, project_id, topology = sys.argv[1:8]
os.makedirs(os.path.dirname(os.path.abspath(f)), exist_ok=True)
try:
    with open(f, 'r') as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        data = {'agents': {}}
except Exception:
    data = {'agents': {}}

a = data.setdefault('agents', {}).setdefault(agent_id, {})
now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
a['status'] = status
a['project_id'] = project_id
a['topology'] = topology
a['updated_at'] = now_iso

if status == 'running':
    if not a.get('started_at') or a.get('finished_at'):
        a['started_at'] = now_iso
    a['finished_at'] = None
    a['runs_count'] = int(a.get('runs_count', 0)) + (1 if not a.get('current_step') else 0)
elif status in ('idle', 'completed', 'error'):
    a['finished_at'] = now_iso

if step:
    a['current_step'] = step
elif status in ('idle', 'completed'):
    a['current_step'] = None

if ec != '':
    try:
        code = int(ec)
        a['last_exit_code'] = code
        if code != 0:
            a['error_count'] = int(a.get('error_count', 0)) + 1
    except Exception:
        pass

tmp = f + '.tmp.' + str(os.getpid())
with open(tmp, 'w') as fh:
    json.dump(data, fh, indent=2)
os.replace(tmp, f)
PYEOF
}

# Safe urgent admin idea parser & executor (fixes the multi-character `cut -d'|||'` bug)
handle_urgent_admin_idea() {
  local agent_id="$1"
  local role_label="$2"
  local ideas_file="${IDEAS_DIR}/admin_ideas.json"

  [ ! -f "$ideas_file" ] && return 1

  local urgent_json
  urgent_json=$(python3 - "$ideas_file" <<'PYEOF' 2>/dev/null
import sys, json
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    urgent = [i for i in data.get('ideas', []) if i.get('urgent') and i.get('status') == 'pending']
    if urgent:
        print(json.dumps(urgent[0]))
except Exception:
    pass
PYEOF
)

  [ -z "$urgent_json" ] && return 1

  local urgent_id urgent_title urgent_desc
  urgent_id=$(python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("id",""))' <<<"$urgent_json" 2>/dev/null)
  urgent_title=$(python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("title",""))' <<<"$urgent_json" 2>/dev/null)
  urgent_desc=$(python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("description",""))' <<<"$urgent_json" 2>/dev/null)

  [ -z "$urgent_title" ] && return 1

  echo "$(date '+%Y-%m-%d %H:%M:%S') — URGENT ADMIN IDEA [$urgent_id]: $urgent_title" >> "$LOG_FILE"
  update_agent_status "$agent_id" "running" "Urgent Admin Request: ${urgent_title:0:50}"

  local smart_ctx
  smart_ctx=$(get_smart_context "$agent_id")

  local override_prompt="You are temporarily acting as a Senior Full-Stack Developer for ${PROJECT_NAME:-the project}. Your normal role is ${role_label}, but the ADMIN has dispatched an URGENT priority override.
Source code path: ${PROJECT_DIR}
Docker Compose file: ${COMPOSE_FILE}

URGENT REQUEST: ${urgent_title}
DETAILS: ${urgent_desc}

${smart_ctx}

RULES:
1. Implement the requested change completely and cleanly without breaking existing functionality.
2. Validate syntax and tests before finishing.
3. Keep context lean using Think-in-Code practices."

  cd "$PROJECT_DIR" 2>/dev/null || return 1
  "$COPILOT" --prompt "$override_prompt" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1
  local urgent_exit=$?

  if [ $urgent_exit -eq 0 ]; then
    python3 - "$ideas_file" "$urgent_id" "$agent_id" <<'PYEOF' 2>/dev/null
import sys, json, datetime
path, uid, agent = sys.argv[1:4]
with open(path) as f:
    data = json.load(f)
for item in data.get('ideas', []):
    if item.get('id') == uid:
        item['status'] = 'implemented'
        item['urgent'] = False
        item['implemented_by'] = agent
        item['implemented_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        break
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
PYEOF
    echo "✅ DONE | $(date '+%Y-%m-%d %H:%M') | ${agent_id} (urgent) | $urgent_title" >> "${IDEAS_DIR}/implemented.log"
  fi

  if git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | grep -q .; then
    git -C "$PROJECT_DIR" add -A
    git -C "$PROJECT_DIR" commit -m "urgent(${agent_id}): $urgent_title

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" >> "$LOG_FILE" 2>&1 || true
    git -C "$PROJECT_DIR" push origin main >> "$LOG_FILE" 2>&1 || true
  fi

  return 0
}

# Retrieve Context-Mode BM25+Trigram+RRF knowledge & smart swarm instructions
get_smart_context() {
  local agent_id="${1:-${CURRENT_AGENT_ID:-developer}}"
  if [ "${CONTEXT_MODE_ENABLED:-true}" != "true" ]; then
    return 0
  fi
  if [ -f "${HIVE_ROOT}/lib/hive-engine.js" ]; then
    node -e "
      try {
        const he = require('${HIVE_ROOT}/lib/hive-engine');
        if (typeof he.buildSmartAgentContext === 'function') {
          console.log(he.buildSmartAgentContext('${agent_id}', '${PROJECT_ID:-}') || '');
        }
      } catch (e) {}
    " 2>/dev/null || true
  fi
}

# Index an agent's output file into the Context-Mode knowledge base
index_agent_output() {
  local agent_id="$1"
  local file_path="$2"
  [ ! -f "$file_path" ] && return 0
  if [ -f "${HIVE_ROOT}/lib/context-mode.js" ]; then
    node -e "
      try {
        const cm = require('${HIVE_ROOT}/lib/context-mode');
        if (typeof cm.indexContent === 'function') {
          cm.indexContent({
            source: 'agent:${agent_id}',
            path: '${file_path}',
            projectId: '${PROJECT_ID:-}'
          });
        }
      } catch (e) {}
    " 2>/dev/null || true
  fi
}
